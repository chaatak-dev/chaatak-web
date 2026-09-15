/**
 * Bhashini (ULCA / Dhruva) calls. Server-side only — the inference key must
 * never reach a browser.
 *
 * Verified against the live service: pipeline config authenticates with the
 * `udyat-key` header, and Dhruva inference with `Authorization`. A TTS →ASR
 * round trip returned the sentence it was given, so both directions work.
 *
 * Service ids are resolved from the pipeline-config endpoint and cached, so a
 * model swap on Bhashini's side is picked up without a deploy.
 */

import { cached } from '../cache';
import type { SpeechLang } from './types';

const ULCA_PIPELINE_URL =
  'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
const DHRUVA_URL = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';
/** MeitY's public pipeline. */
const PIPELINE_ID = process.env.BHASHINI_PIPELINE_ID ?? '64392f96daac500b55c543cd';

const CONFIG_TTL = 12 * 60 * 60 * 1000;
const ASR_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 30_000;

export function bhashiniConfigured(): boolean {
  return Boolean(
    process.env.BHASHINI_UDYAT_KEY && process.env.BHASHINI_INFERENCE_KEY,
  );
}

type ServiceLookup = { serviceId: string } | null;

/** Asks ULCA which model currently serves this task and language. */
async function serviceIdFor(
  task: 'asr' | 'tts',
  lang: SpeechLang,
): Promise<ServiceLookup> {
  const udyat = process.env.BHASHINI_UDYAT_KEY;
  if (!udyat) return null;

  return cached<ServiceLookup>(`bhashini:${task}:${lang}`, CONFIG_TTL, async () => {
    try {
      const res = await fetch(ULCA_PIPELINE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'udyat-key': udyat },
        body: JSON.stringify({
          pipelineTasks: [
            { taskType: task, config: { language: { sourceLanguage: lang } } },
          ],
          pipelineRequestConfig: { pipelineId: PIPELINE_ID },
        }),
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      });
      if (!res.ok) return null;

      const body = (await res.json()) as {
        pipelineResponseConfig?: { taskType: string; config?: { serviceId?: string }[] }[];
      };
      const serviceId = body.pipelineResponseConfig?.find((c) => c.taskType === task)
        ?.config?.[0]?.serviceId;
      return serviceId ? { serviceId } : null;
    } catch {
      return null;
    }
  });
}

export type AsrOutcome =
  | { kind: 'heard'; transcript: string }
  | { kind: 'heardNothing' }
  | { kind: 'failed'; reason: string };

export async function bhashiniAsr(
  audioBase64: string,
  lang: SpeechLang,
  samplingRate: number,
): Promise<AsrOutcome> {
  const key = process.env.BHASHINI_INFERENCE_KEY;
  const service = await serviceIdFor('asr', lang);
  if (!key || !service) return { kind: 'failed', reason: 'bhashini unavailable' };

  try {
    const res = await fetch(DHRUVA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'asr',
            config: {
              language: { sourceLanguage: lang },
              serviceId: service.serviceId,
              audioFormat: 'wav',
              samplingRate,
            },
          },
        ],
        inputData: { audio: [{ audioContent: audioBase64 }] },
      }),
      signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { kind: 'failed', reason: `HTTP ${res.status}` };

    const body = (await res.json()) as {
      pipelineResponse?: { output?: { source?: string }[] }[];
    };
    const transcript = body.pipelineResponse?.[0]?.output?.[0]?.source?.trim();

    // Empty is a real answer — silence, or speech it could not resolve. It is
    // never turned into a guess.
    if (!transcript) return { kind: 'heardNothing' };
    return { kind: 'heard', transcript };
  } catch (error) {
    return {
      kind: 'failed',
      reason: error instanceof Error ? error.name : 'network error',
    };
  }
}

export type TtsOutcome =
  | { kind: 'audio'; wav: ArrayBuffer }
  | { kind: 'failed'; reason: string };

export async function bhashiniTts(
  text: string,
  lang: SpeechLang,
): Promise<TtsOutcome> {
  const key = process.env.BHASHINI_INFERENCE_KEY;
  const service = await serviceIdFor('tts', lang);
  if (!key || !service) return { kind: 'failed', reason: 'bhashini unavailable' };

  try {
    const res = await fetch(DHRUVA_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({
        pipelineTasks: [
          {
            taskType: 'tts',
            config: {
              language: { sourceLanguage: lang },
              serviceId: service.serviceId,
              gender: process.env.BHASHINI_TTS_VOICE ?? 'female',
              samplingRate: 22050,
            },
          },
        ],
        inputData: { input: [{ source: text }] },
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) return { kind: 'failed', reason: `HTTP ${res.status}` };

    const body = (await res.json()) as {
      pipelineResponse?: { audio?: { audioContent?: string }[] }[];
    };
    const base64 = body.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
    if (!base64) return { kind: 'failed', reason: 'no audio returned' };

    return { kind: 'audio', wav: Buffer.from(base64, 'base64').buffer as ArrayBuffer };
  } catch (error) {
    return {
      kind: 'failed',
      reason: error instanceof Error ? error.name : 'network error',
    };
  }
}

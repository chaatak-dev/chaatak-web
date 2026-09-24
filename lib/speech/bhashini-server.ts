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
import { chooseTranscript, decisiveIndic, readsAsNative, type Heard } from './detect';
import type { SpeechLang } from './types';

const ULCA_PIPELINE_URL =
  'https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline';
const DHRUVA_URL = 'https://dhruva-api.bhashini.gov.in/services/inference/pipeline';
/** MeitY's public pipeline. */
const PIPELINE_ID = process.env.BHASHINI_PIPELINE_ID ?? '64392f96daac500b55c543cd';

const CONFIG_TTL = 12 * 60 * 60 * 1000;
/**
 * A recogniser answers in a fraction of a second (measured: 0.2–0.9 s). One
 * that has not answered in twelve is not going to, and a person standing with
 * the phone waits for this — thirty seconds of "Checking…" reads as broken.
 */
const ASR_TIMEOUT_MS = 12_000;
const TTS_TIMEOUT_MS = 30_000;
/**
 * Dhruva fails the odd call outright (about one in twenty when measured) and
 * answers the same audio at once when asked again. A failure that came back
 * fast is retried once; a timeout is not, because the time is already spent.
 */
const RETRY_WITHIN_MS = 4_000;
const RETRY_DELAY_MS = 250;

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
    // A lookup that failed is not an answer to keep: caching it held that
    // language's speech off for twelve hours after one bad response.
  }, (lookup) => lookup !== null);
}

/**
 * Look up the services a session is about to need, before it needs them.
 * Called when a voice session starts, so the first question does not pay for
 * a configuration round trip on top of its own. Best-effort: a failure here
 * is found again, and reported, by the call that needed it.
 */
export async function warmBhashini(langs: readonly SpeechLang[]): Promise<void> {
  if (!bhashiniConfigured()) return;
  await Promise.all(langs.flatMap((lang) => [serviceIdFor('asr', lang), serviceIdFor('tts', lang)]));
}

export type AsrOutcome =
  | { kind: 'heard'; transcript: string }
  | { kind: 'heardNothing' }
  | { kind: 'failed'; reason: string };

/**
 * @param signal aborts the call — used when another recogniser has already
 *   settled the question and this answer is no longer needed
 */
export async function bhashiniAsr(
  audioBase64: string,
  lang: SpeechLang,
  samplingRate: number,
  signal?: AbortSignal,
): Promise<AsrOutcome> {
  const key = process.env.BHASHINI_INFERENCE_KEY;
  const service = await serviceIdFor('asr', lang);
  if (!key || !service) return { kind: 'failed', reason: 'bhashini unavailable' };

  const began = Date.now();
  const attempt = async (): Promise<AsrOutcome & { retryable?: boolean }> => {
    try {
      const timeout = AbortSignal.timeout(ASR_TIMEOUT_MS);
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
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        cache: 'no-store',
      });
      if (!res.ok) {
        return { kind: 'failed', reason: `HTTP ${res.status}`, retryable: res.status >= 500 || res.status === 429 };
      }

      const body = (await res.json()) as {
        pipelineResponse?: { output?: { source?: string }[] }[];
      };
      const transcript = body.pipelineResponse?.[0]?.output?.[0]?.source?.trim();

      // Empty is a real answer — silence, or speech it could not resolve. It is
      // never turned into a guess.
      if (!transcript) return { kind: 'heardNothing' };
      return { kind: 'heard', transcript };
    } catch (error) {
      const name = error instanceof Error ? error.name : 'network error';
      // A timeout or an abort is not retried: the time is spent, or the
      // answer is no longer wanted.
      return { kind: 'failed', reason: name, retryable: name !== 'TimeoutError' && name !== 'AbortError' };
    }
  };

  let outcome = await attempt();
  if (outcome.kind === 'failed' && outcome.retryable && !signal?.aborted && Date.now() - began < RETRY_WITHIN_MS) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    if (!signal?.aborted) outcome = await attempt();
  }
  if (outcome.kind === 'failed') return { kind: 'failed', reason: outcome.reason };
  return outcome;
}

export type AutoOutcome =
  | {
      kind: 'heard';
      transcript: string;
      lang: SpeechLang;
      confidence: 'high' | 'medium' | 'low';
      /** Why that language — for the log, never for the person. */
      reason: string;
      /** Which recognisers were asked. */
      asked: SpeechLang[];
    }
  | { kind: 'heardNothing' }
  | { kind: 'failed'; reason: string };

/**
 * Transcribe without being told the language: ask the candidate recognisers
 * and judge what each heard — see ./detect.ts for why that is evidence.
 *
 * A conversation already confidently in an Indic language asks its own
 * recogniser first, and accepts the result when it reads as that language —
 * one round trip. Otherwise, or when it does not read as native, the
 * candidates are asked in parallel — and the answer is given as soon as it is
 * settled, not when the last recogniser returns. English (Whisper) is the
 * slowest of them (measured: 0.4–0.8 s against 0.2–0.3 s for Hindi) and the
 * least informative, so a question the Indic transcripts already decide does
 * not wait for it.
 */
export async function transcribeAuto(
  audioBase64: string,
  samplingRate: number,
  opts: { candidates: SpeechLang[]; prior?: SpeechLang | null; fastPath?: boolean },
): Promise<AutoOutcome> {
  const { candidates, prior } = opts;
  const results = new Map<SpeechLang, AsrOutcome>();

  if (opts.fastPath && prior && prior !== 'en') {
    const first = await bhashiniAsr(audioBase64, prior, samplingRate);
    results.set(prior, first);
    if (first.kind === 'heard' && readsAsNative({ lang: prior, transcript: first.transcript })) {
      return {
        kind: 'heard',
        transcript: first.transcript,
        lang: prior,
        confidence: 'high',
        reason: `read as ${prior} on the conversation's own recogniser`,
        asked: [prior],
      };
    }
  }

  const heardSoFar = (): Heard[] =>
    [...results.entries()]
      .filter((entry): entry is [SpeechLang, Extract<AsrOutcome, { kind: 'heard' }>] => entry[1].kind === 'heard')
      .map(([lang, outcome]) => ({ lang, transcript: outcome.transcript }));

  const rest = candidates.filter((l) => !results.has(l));
  const asked = [...results.keys(), ...rest];
  const abandon = new AbortController();

  const early = await new Promise<ReturnType<typeof decisiveIndic>>((resolve) => {
    let pending = rest.length;
    if (pending === 0) return resolve(null);
    for (const lang of rest) {
      void bhashiniAsr(audioBase64, lang, samplingRate, abandon.signal).then((outcome) => {
        results.set(lang, outcome);
        pending -= 1;
        const indicOutstanding = asked.some((l) => l !== 'en' && !results.has(l));
        const decided = pending > 0 && !indicOutstanding ? decisiveIndic(heardSoFar()) : null;
        if (decided) return resolve(decided);
        if (pending === 0) resolve(null);
      });
    }
  });

  if (early) {
    abandon.abort();
    return { kind: 'heard', ...early, asked };
  }

  const detection = chooseTranscript(heardSoFar(), prior);
  if (detection) {
    return { kind: 'heard', ...detection, asked };
  }

  // Nothing heard anywhere: silence, if any recogniser said so; otherwise
  // every one of them failed, and that is a failure.
  const outcomes = [...results.values()];
  if (outcomes.some((o) => o.kind === 'heardNothing')) return { kind: 'heardNothing' };
  const failed = outcomes.find((o): o is Extract<AsrOutcome, { kind: 'failed' }> => o.kind === 'failed');
  return { kind: 'failed', reason: failed?.reason ?? 'no recogniser answered' };
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

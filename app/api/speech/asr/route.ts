/**
 * /api/speech/asr
 *
 *   GET   whether server-side recognition is available at all, so a client
 *         picks its engine once instead of discovering it one failed
 *         utterance at a time
 *   POST  captured audio in, a transcript out
 *
 * Exists so the Bhashini inference key stays on the server: the browser never
 * sees it.
 *
 * The language is the caller's choice, or `auto` — in which case it is
 * DETECTED here from what the recognisers heard (see lib/speech/detect.ts)
 * and returned with how sure the detection was. The transcript itself is
 * returned exactly as the engine produced it: nothing here corrects
 * spelling, transliterates, or trims words.
 */

import { isLanguageCode } from '@/lib/i18n/languages';
import { candidatesFor } from '@/lib/speech/detect';
import { bhashiniAsr, bhashiniConfigured, transcribeAuto } from '@/lib/speech/bhashini-server';
import type { SpeechLang } from '@/lib/speech/types';

/** Roughly 60s of 16kHz mono PCM16, base64-encoded. */
const MAX_BODY_BYTES = 3_000_000;

export async function GET(): Promise<Response> {
  return Response.json({ configured: bhashiniConfigured() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
  if (!bhashiniConfigured()) {
    return Response.json(
      { kind: 'failed', reason: 'speech service not configured' },
      { status: 503 },
    );
  }

  let body: {
    audio?: string;
    lang?: string;
    sampleRate?: number;
    /** The conversation's language so far — used only to break a tie. */
    prior?: string;
    /** The device's language, as a candidate for the Indic recogniser. */
    device?: string;
    /** The conversation has been confidently in `prior`: try it first. */
    priorConfident?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ kind: 'failed', reason: 'malformed body' }, { status: 400 });
  }

  const audio = body.audio;
  if (typeof audio !== 'string' || !audio) {
    return Response.json({ kind: 'failed', reason: 'no audio' }, { status: 400 });
  }
  if (audio.length > MAX_BODY_BYTES) {
    return Response.json({ kind: 'failed', reason: 'audio too long' }, { status: 413 });
  }

  const sampleRate = Number(body.sampleRate) || 16_000;

  // A named language: one recogniser, the one asked for. Any of the seven —
  // this used to coerce everything that was not English to Hindi, so Tamil
  // audio was transcribed by the Hindi model.
  if (isLanguageCode(body.lang)) {
    const lang: SpeechLang = body.lang;
    const outcome = await bhashiniAsr(audio, lang, sampleRate);
    return Response.json(
      outcome.kind === 'heard' ? { ...outcome, lang, detected: false } : outcome,
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  // Automatic: detect.
  const prior = isLanguageCode(body.prior) ? body.prior : null;
  const device = isLanguageCode(body.device) ? body.device : null;
  const outcome = await transcribeAuto(audio, sampleRate, {
    candidates: candidatesFor(prior, device),
    prior,
    fastPath: body.priorConfident === true,
  });

  if (outcome.kind === 'heard') {
    // Logged without the words: a transcript can name where someone lives.
    console.log(
      JSON.stringify({
        event: 'asr.detected',
        lang: outcome.lang,
        confidence: outcome.confidence,
        reason: outcome.reason,
        asked: outcome.asked,
      }),
    );
    return Response.json({ ...outcome, detected: true }, { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json(outcome, { headers: { 'cache-control': 'no-store' } });
}

/**
 * POST /api/speech/asr
 *
 * Takes captured audio, returns a transcript. Exists so the Bhashini
 * inference key stays on the server: the browser never sees it.
 *
 * The transcript is returned exactly as the engine produced it. Nothing here
 * corrects spelling, transliterates, or trims words — ASR output goes to the
 * query layer unaltered.
 */

import { bhashiniAsr, bhashiniConfigured } from '@/lib/speech/bhashini-server';
import type { SpeechLang } from '@/lib/speech/types';

/** Roughly 60s of 16kHz mono PCM16, base64-encoded. */
const MAX_BODY_BYTES = 3_000_000;

export async function POST(request: Request): Promise<Response> {
  if (!bhashiniConfigured()) {
    return Response.json(
      { kind: 'failed', reason: 'speech service not configured' },
      { status: 503 },
    );
  }

  let body: { audio?: string; lang?: string; sampleRate?: number };
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

  const lang: SpeechLang = body.lang === 'en' ? 'en' : 'hi';
  const sampleRate = Number(body.sampleRate) || 16_000;

  const outcome = await bhashiniAsr(audio, lang, sampleRate);
  return Response.json(outcome, { headers: { 'cache-control': 'no-store' } });
}

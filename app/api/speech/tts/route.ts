/**
 * POST /api/speech/tts
 *
 * Takes text, returns speakable audio. Exists so the Bhashini inference key
 * stays on the server.
 *
 * Bhashini returns IEEE-float WAV, which desktop Chrome decodes and cheap
 * Android handsets are exactly where that stops working. It is converted to
 * 16-bit PCM here rather than client-side, because a warning the user cannot
 * hear is a failed warning and the fix belongs where it is guaranteed to run.
 */

import { isLanguageCode } from '@/lib/i18n/languages';
import { bhashiniConfigured, bhashiniTts } from '@/lib/speech/bhashini-server';
import type { SpeechLang } from '@/lib/speech/types';
import { toPcm16Wav } from '@/lib/speech/wav';

const MAX_CHARS = 1200;

export async function POST(request: Request): Promise<Response> {
  if (!bhashiniConfigured()) {
    return Response.json(
      { kind: 'failed', reason: 'speech service not configured' },
      { status: 503 },
    );
  }

  let body: { text?: string; lang?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ kind: 'failed', reason: 'malformed body' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return Response.json({ kind: 'failed', reason: 'no text' }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return Response.json({ kind: 'failed', reason: 'text too long' }, { status: 413 });
  }

  // Any of the seven. This used to coerce everything but English to Hindi,
  // so a Tamil answer was read out by the Hindi voice.
  if (!isLanguageCode(body.lang)) {
    return Response.json({ kind: 'failed', reason: 'unknown language' }, { status: 400 });
  }
  const lang: SpeechLang = body.lang;
  const outcome = await bhashiniTts(text, lang);
  if (outcome.kind === 'failed') {
    return Response.json(outcome, { status: 502 });
  }

  const pcm = toPcm16Wav(outcome.wav);
  if (!pcm) {
    return Response.json(
      { kind: 'failed', reason: 'unreadable audio from source' },
      { status: 502 },
    );
  }

  return new Response(pcm, {
    headers: {
      'content-type': 'audio/wav',
      'content-length': String(pcm.byteLength),
      'cache-control': 'no-store',
    },
  });
}

/**
 * /api/speech/asr
 *
 *   GET   whether server-side recognition is available at all, so a client
 *         picks its engine once instead of discovering it one failed
 *         utterance at a time. Asked when a voice session starts, it also
 *         looks up the recognisers that session is about to need, so the
 *         first question does not pay for that lookup.
 *   POST  captured audio in, a transcript out
 *
 * Exists so the Bhashini inference key stays on the server: the browser never
 * sees it.
 *
 * The audio arrives as the request body — a WAV, μ-law or 16-bit PCM — with
 * the language options in the query string. It used to be base64 inside JSON,
 * a third larger, on the uplink of a rural connection; JSON is still accepted.
 * Whatever arrives is widened to 16-bit PCM here, at the rate its own header
 * states, before a recogniser sees it.
 *
 * The language is the caller's choice, or `auto` — in which case it is
 * DETECTED here from what the recognisers heard (see lib/speech/detect.ts)
 * and returned with how sure the detection was. The transcript itself is
 * returned exactly as the engine produced it: nothing here corrects
 * spelling, transliterates, or trims words.
 *
 * Outcomes: `heard` and `heardNothing` are answers (200). `failed` is not —
 * it is a 502, so a client can tell "the recogniser did not answer" from "you
 * said nothing", which it once could not, and asked a person to repeat
 * themselves into a service that was down.
 */

import { after } from 'next/server';
import { isLanguageCode } from '@/lib/i18n/languages';
import { candidatesFor } from '@/lib/speech/detect';
import { bhashiniAsr, bhashiniConfigured, transcribeAuto, warmBhashini } from '@/lib/speech/bhashini-server';
import type { SpeechLang } from '@/lib/speech/types';
import { normaliseWav } from '@/lib/speech/wav';

/** 15 s of 16 kHz PCM16 is under 500 KB; this leaves room and refuses abuse. */
const MAX_AUDIO_BYTES = 2_000_000;
/** The same, base64-encoded, for the JSON form. */
const MAX_BASE64_CHARS = Math.ceil((MAX_AUDIO_BYTES * 4) / 3);

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  const configured = bhashiniConfigured();
  if (configured) {
    const url = new URL(request.url);
    const warm = (url.searchParams.get('warm') ?? '')
      .split(',')
      .filter((l): l is SpeechLang => isLanguageCode(l));
    if (warm.length) after(() => warmBhashini([...new Set(warm)].slice(0, 3)));
  }
  return Response.json({ configured }, { headers: NO_STORE });
}

type Options = {
  lang: string | null;
  /** The conversation's language so far — used only to break a tie. */
  prior: string | null;
  /** The device's language, as a candidate for the Indic recogniser. */
  device: string | null;
  /** The conversation has been confidently in `prior`: try it first. */
  priorConfident: boolean;
};

const failed = (reason: string, status: number) =>
  Response.json({ kind: 'failed', reason }, { status, headers: NO_STORE });

export async function POST(request: Request): Promise<Response> {
  if (!bhashiniConfigured()) return failed('speech service not configured', 503);

  let wav: ArrayBuffer;
  let options: Options;
  const type = request.headers.get('content-type') ?? '';

  if (type.includes('application/json')) {
    let body: { audio?: string; lang?: string; prior?: string; device?: string; priorConfident?: boolean };
    try {
      body = await request.json();
    } catch {
      return failed('malformed body', 400);
    }
    if (typeof body.audio !== 'string' || !body.audio) return failed('no audio', 400);
    if (body.audio.length > MAX_BASE64_CHARS) return failed('audio too long', 413);
    const bytes = Buffer.from(body.audio, 'base64');
    wav = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    options = {
      lang: body.lang ?? null,
      prior: body.prior ?? null,
      device: body.device ?? null,
      priorConfident: body.priorConfident === true,
    };
  } else {
    const declared = Number(request.headers.get('content-length'));
    if (declared > MAX_AUDIO_BYTES) return failed('audio too long', 413);
    wav = await request.arrayBuffer();
    if (wav.byteLength === 0) return failed('no audio', 400);
    if (wav.byteLength > MAX_AUDIO_BYTES) return failed('audio too long', 413);
    const query = new URL(request.url).searchParams;
    options = {
      lang: query.get('lang'),
      prior: query.get('prior'),
      device: query.get('device'),
      priorConfident: query.get('confident') === '1',
    };
  }

  const audio = normaliseWav(wav);
  if (!audio) return failed('unreadable audio', 400);
  const base64 = Buffer.from(audio.wav).toString('base64');
  const sampleRate = audio.sampleRate;

  // A named language: one recogniser, the one asked for. Any of the seven —
  // this used to coerce everything that was not English to Hindi, so Tamil
  // audio was transcribed by the Hindi model.
  if (isLanguageCode(options.lang)) {
    const lang: SpeechLang = options.lang;
    const outcome = await bhashiniAsr(base64, lang, sampleRate);
    if (outcome.kind === 'failed') return failed(outcome.reason, 502);
    return Response.json(outcome.kind === 'heard' ? { ...outcome, lang, detected: false } : outcome, {
      headers: NO_STORE,
    });
  }

  // Automatic: detect.
  const prior = isLanguageCode(options.prior) ? options.prior : null;
  const device = isLanguageCode(options.device) ? options.device : null;
  const began = Date.now();
  const outcome = await transcribeAuto(base64, sampleRate, {
    candidates: candidatesFor(prior, device),
    prior,
    fastPath: options.priorConfident,
  });

  if (outcome.kind === 'failed') return failed(outcome.reason, 502);
  if (outcome.kind === 'heard') {
    // Logged without the words: a transcript can name where someone lives.
    console.log(
      JSON.stringify({
        event: 'asr.detected',
        lang: outcome.lang,
        confidence: outcome.confidence,
        reason: outcome.reason,
        asked: outcome.asked,
        ms: Date.now() - began,
        audioBytes: wav.byteLength,
      }),
    );
    return Response.json({ ...outcome, detected: true }, { headers: NO_STORE });
  }
  return Response.json(outcome, { headers: NO_STORE });
}

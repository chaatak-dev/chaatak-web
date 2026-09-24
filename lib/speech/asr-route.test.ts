import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GET, POST } from '../../app/api/speech/asr/route';
import { encodeMulawWav, encodePcm16Wav } from './wav';

/**
 * The recognition route, with Bhashini stubbed at the network. What is
 * asserted: the audio arrives however the client sends it, reaches Dhruva as
 * 16-bit PCM at its real rate, and a recogniser that did not answer is a 502
 * — never the same reply as silence.
 */

process.env.BHASHINI_UDYAT_KEY = 'test-udyat';
process.env.BHASHINI_INFERENCE_KEY = 'test-inference';

type Seen = { lang: string; samplingRate: number; format: number; bits: number };

async function withDhruva<T>(answer: (lang: string) => Response, run: (seen: Seen[]) => Promise<T>): Promise<T> {
  const seen: Seen[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const task = body.pipelineTasks?.[0];
    const lang: string = task?.config?.language?.sourceLanguage;
    if (String(input).includes('getModelsPipeline')) {
      return Response.json({ pipelineResponseConfig: [{ taskType: task.taskType, config: [{ serviceId: `svc-${lang}` }] }] });
    }
    const wav = Buffer.from(body.inputData.audio[0].audioContent, 'base64');
    seen.push({ lang, samplingRate: task.config.samplingRate, format: wav.readUInt16LE(20), bits: wav.readUInt16LE(34) });
    return answer(lang);
  }) as typeof fetch;
  try {
    return await run(seen);
  } finally {
    globalThis.fetch = real;
  }
}

const tone = new Float32Array(8000).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 200 * i) / 16_000));
const transcript = (text: string) => Response.json({ pipelineResponse: [{ output: [{ source: text }] }] });

test('a μ-law WAV body is widened to PCM16 before Dhruva hears it', async () => {
  await withDhruva(
    () => transcript('कल बारिश होगी क्या'),
    async (seen) => {
      const res = await POST(
        new Request('http://x/api/speech/asr?lang=hi', {
          method: 'POST',
          headers: { 'content-type': 'audio/wav' },
          body: encodeMulawWav(tone, 16_000),
        }),
      );
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { kind: 'heard', transcript: 'कल बारिश होगी क्या', lang: 'hi', detected: false });
      assert.deepEqual(seen, [{ lang: 'hi', samplingRate: 16_000, format: 1, bits: 16 }]);
    },
  );
});

test('auto detects from the query string options, and says what it detected', async () => {
  await withDhruva(
    (lang) => transcript(lang === 'hi' ? 'आज का मौसम कैसा है' : 'How is the weather today?'),
    async () => {
      const res = await POST(
        new Request('http://x/api/speech/asr?lang=auto&prior=hi&device=hi', {
          method: 'POST',
          headers: { 'content-type': 'audio/wav' },
          body: encodeMulawWav(tone, 16_000),
        }),
      );
      const body = await res.json();
      assert.equal(body.kind, 'heard');
      assert.equal(body.lang, 'hi');
      assert.equal(body.detected, true);
    },
  );
});

test('the older JSON form still works, at the rate its WAV header states', async () => {
  await withDhruva(
    () => transcript('Delhi'),
    async (seen) => {
      const audio = Buffer.from(encodePcm16Wav(tone, 8_000)).toString('base64');
      const res = await POST(
        new Request('http://x/api/speech/asr', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audio, lang: 'en', sampleRate: 16_000 }),
        }),
      );
      assert.equal(res.status, 200);
      assert.equal((await res.json()).transcript, 'Delhi');
      assert.equal(seen[0].samplingRate, 8_000, 'the header, not a claim in the body');
    },
  );
});

test('a recogniser that did not answer is a 502, not "heard nothing"', async () => {
  await withDhruva(
    () => new Response('down', { status: 503 }),
    async () => {
      const res = await POST(
        new Request('http://x/api/speech/asr?lang=hi', {
          method: 'POST',
          headers: { 'content-type': 'audio/wav' },
          body: encodeMulawWav(tone, 16_000),
        }),
      );
      assert.equal(res.status, 502);
      assert.equal((await res.json()).kind, 'failed');
    },
  );
});

test('silence is an answer: heardNothing, 200', async () => {
  await withDhruva(
    () => transcript(''),
    async () => {
      const res = await POST(
        new Request('http://x/api/speech/asr?lang=hi', {
          method: 'POST',
          headers: { 'content-type': 'audio/wav' },
          body: encodeMulawWav(tone, 16_000),
        }),
      );
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { kind: 'heardNothing' });
    },
  );
});

test('bytes that are not audio are refused before any recogniser is paid for', async () => {
  await withDhruva(
    () => transcript('should not be asked'),
    async (seen) => {
      const res = await POST(
        new Request('http://x/api/speech/asr?lang=hi', {
          method: 'POST',
          headers: { 'content-type': 'audio/wav' },
          body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
        }),
      );
      assert.equal(res.status, 400);
      assert.equal(seen.length, 0);
    },
  );
});

test('GET says whether recognition is configured', async () => {
  const res = await GET(new Request('http://x/api/speech/asr'));
  assert.deepEqual(await res.json(), { configured: true });
});

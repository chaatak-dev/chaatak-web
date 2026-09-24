import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bhashiniAsr, transcribeAuto } from './bhashini-server';

/**
 * The recognisers, stubbed at the network: ULCA answers which service serves
 * a language, and Dhruva answers with whatever this test says that language's
 * recogniser "heard". What is asserted is the routing and the choosing.
 */

process.env.BHASHINI_UDYAT_KEY = 'test-udyat';
process.env.BHASHINI_INFERENCE_KEY = 'test-inference';

type Heard = Partial<Record<string, string | null>>;

async function withRecognisers<T>(heard: Heard, run: (asked: string[]) => Promise<T>): Promise<T> {
  const asked: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? '{}'));
    const task = body.pipelineTasks?.[0];
    const lang: string = task?.config?.language?.sourceLanguage;
    if (url.includes('getModelsPipeline')) {
      return Response.json({ pipelineResponseConfig: [{ taskType: task.taskType, config: [{ serviceId: `svc-${lang}` }] }] });
    }
    asked.push(lang);
    const transcript = heard[lang];
    if (transcript === null) return new Response('down', { status: 503 });
    return Response.json({ pipelineResponse: [{ output: [{ source: transcript ?? '' }] }] });
  }) as typeof fetch;
  try {
    return await run(asked);
  } finally {
    globalThis.fetch = real;
  }
}

test('English speech is detected as English', async () => {
  await withRecognisers(
    { hi: 'वॉट इसज़ द वेदर इन लखनऊ टुमारो', en: 'What is the weather in Lucknow tomorrow?' },
    async () => {
      const out = await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'] });
      assert.equal(out.kind, 'heard');
      if (out.kind !== 'heard') return;
      assert.equal(out.lang, 'en');
      assert.equal(out.transcript, 'What is the weather in Lucknow tomorrow?');
    },
  );
});

test('Hindi speech is detected as Hindi, whatever Whisper translated it to', async () => {
  await withRecognisers(
    { hi: 'गाजियाबाद में आखिरी बारिश कब हुई थी', en: 'When was the last rain in Ghaziabad?' },
    async () => {
      const out = await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'] });
      assert.equal(out.kind === 'heard' && out.lang, 'hi');
      assert.equal(out.kind === 'heard' && out.transcript, 'गाजियाबाद में आखिरी बारिश कब हुई थी');
    },
  );
});

test('a confident Hindi conversation asks one recogniser when the answer is plainly Hindi', async () => {
  await withRecognisers({ hi: 'और कल बारिश होगी क्या', en: 'or call' }, async (asked) => {
    const out = await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'], prior: 'hi', fastPath: true });
    assert.equal(out.kind === 'heard' && out.lang, 'hi');
    assert.deepEqual(asked, ['hi'], 'one round trip');
  });
});

test('…and notices when the person switched to English', async () => {
  await withRecognisers({ hi: 'एंड वॉट अबाउट द विन्', en: 'And what about the wind?' }, async (asked) => {
    const out = await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'], prior: 'hi', fastPath: true });
    assert.equal(out.kind === 'heard' && out.lang, 'en');
    assert.deepEqual(asked.sort(), ['en', 'hi']);
  });
});

test('one recogniser down is not a failure when another heard', async () => {
  await withRecognisers({ hi: null, en: 'Weather in Delhi' }, async () => {
    const out = await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'] });
    assert.equal(out.kind === 'heard' && out.lang, 'en');
  });
});

test('silence is heardNothing; every recogniser down is failed', async () => {
  await withRecognisers({ hi: '', en: '' }, async () => {
    assert.equal((await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'] })).kind, 'heardNothing');
  });
  await withRecognisers({ hi: null, en: null }, async () => {
    assert.equal((await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'] })).kind, 'failed');
  });
});

test('a named language reaches its own recogniser — Tamil is not sent to Hindi', async () => {
  await withRecognisers({ ta: 'சென்னையில் மழை', hi: 'wrong model' }, async (asked) => {
    const out = await bhashiniAsr('AAAA', 'ta', 16000);
    assert.deepEqual(out, { kind: 'heard', transcript: 'சென்னையில் மழை' });
    assert.deepEqual(asked, ['ta']);
  });
});

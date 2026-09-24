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

/**
 * Recognisers that take time, or fail a set number of times first. Each
 * language's recogniser answers after `delay[lang]` ms; `failFirst[lang]`
 * calls answer 503 before it starts answering properly. Aborted calls are
 * recorded.
 */
async function withTimedRecognisers<T>(
  heard: Record<string, string>,
  opts: { delay?: Record<string, number>; failFirst?: Record<string, number>; lookupFailsFirst?: Record<string, number> },
  run: (log: { asked: string[]; aborted: string[] }) => Promise<T>,
): Promise<T> {
  const log = { asked: [] as string[], aborted: [] as string[] };
  const failures = { ...(opts.failFirst ?? {}) };
  const lookupFailures = { ...(opts.lookupFailsFirst ?? {}) };
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const task = body.pipelineTasks?.[0];
    const lang: string = task?.config?.language?.sourceLanguage;
    if (String(input).includes('getModelsPipeline')) {
      if ((lookupFailures[lang] ?? 0) > 0) {
        lookupFailures[lang] -= 1;
        return new Response('busy', { status: 503 });
      }
      return Response.json({ pipelineResponseConfig: [{ taskType: task.taskType, config: [{ serviceId: `svc-${lang}` }] }] });
    }
    log.asked.push(lang);
    if ((failures[lang] ?? 0) > 0) {
      failures[lang] -= 1;
      return new Response('down', { status: 503 });
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolve();
      }, opts.delay?.[lang] ?? 0);
      init?.signal?.addEventListener('abort', () => {
        if (settled) return;
        clearTimeout(timer);
        log.aborted.push(lang);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
    return Response.json({ pipelineResponse: [{ output: [{ source: heard[lang] ?? '' }] }] });
  }) as typeof fetch;
  try {
    return await run(log);
  } finally {
    globalThis.fetch = real;
  }
}

test('Hindi that reads as Hindi is answered without waiting for the slower English recogniser', async () => {
  await withTimedRecognisers(
    { hi: 'कल लखनऊ में बारिश होगी क्या', en: 'Will it rain in Lucknow tomorrow?' },
    { delay: { hi: 20, en: 600 } },
    async (log) => {
      const began = Date.now();
      const out = await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'] });
      const took = Date.now() - began;
      assert.equal(out.kind === 'heard' && out.lang, 'hi');
      assert.equal(out.kind === 'heard' && out.transcript, 'कल लखनऊ में बारिश होगी क्या');
      assert.ok(took < 400, `answered in ${took} ms, not after English's 600`);
      assert.deepEqual(log.aborted, ['en'], 'the answer nobody needs is abandoned');
    },
  );
});

test('…but English speech still waits for Whisper, because the Hindi transcript alone cannot say what was said', async () => {
  await withTimedRecognisers(
    { hi: 'वॉट इज़ द वेदर इन डेली', en: 'What is the weather in Delhi?' },
    { delay: { hi: 10, en: 120 } },
    async (log) => {
      const out = await transcribeAuto('AAAA', 16000, { candidates: ['hi', 'en'] });
      assert.equal(out.kind === 'heard' && out.lang, 'en');
      assert.equal(out.kind === 'heard' && out.transcript, 'What is the weather in Delhi?');
      assert.deepEqual(log.aborted, []);
    },
  );
});

test('with two Indic candidates, both are heard before deciding early', async () => {
  // Tamil's recogniser is slower here; Hindi alone reading as Hindi must not
  // settle it while Tamil might read better.
  await withTimedRecognisers(
    { ta: 'இன்று மழை பெய்யுமா என்ன', hi: 'इन दो मजा', en: 'Will it rain today?' },
    { delay: { hi: 10, ta: 80, en: 500 } },
    async () => {
      const out = await transcribeAuto('AAAA', 16000, { candidates: ['ta', 'hi', 'en'] });
      assert.equal(out.kind === 'heard' && out.lang, 'ta');
    },
  );
});

test('a recogniser that fails once, fast, is asked again — Dhruva drops the odd call', async () => {
  await withTimedRecognisers({ mr: 'उद्या पाऊस पडेल का' }, { failFirst: { mr: 1 } }, async (log) => {
    const out = await bhashiniAsr('AAAA', 'mr', 16000);
    assert.deepEqual(out, { kind: 'heard', transcript: 'उद्या पाऊस पडेल का' });
    assert.deepEqual(log.asked, ['mr', 'mr']);
  });
  await withTimedRecognisers({ bn: 'আজ বৃষ্টি হবে' }, { failFirst: { bn: 2 } }, async (log) => {
    const out = await bhashiniAsr('AAAA', 'bn', 16000);
    assert.equal(out.kind, 'failed', 'once, not forever');
    assert.deepEqual(log.asked, ['bn', 'bn']);
  });
});

test('a failed service lookup is not remembered — one bad answer used to silence a language for twelve hours', async () => {
  await withTimedRecognisers({ gu: 'આજે વરસાદ પડશે' }, { lookupFailsFirst: { gu: 1 } }, async () => {
    const first = await bhashiniAsr('AAAA', 'gu', 16000);
    assert.deepEqual(first, { kind: 'failed', reason: 'bhashini unavailable' });
    const second = await bhashiniAsr('AAAA', 'gu', 16000);
    assert.deepEqual(second, { kind: 'heard', transcript: 'આજે વરસાદ પડશે' });
  });
});

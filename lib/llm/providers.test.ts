import { test } from 'node:test';
import assert from 'node:assert/strict';

import { geminiModel } from './gemini';
import { groqModel } from './groq';

/**
 * A completion the provider stopped at its token limit is not an answer.
 *
 * Found live: the fallback is a reasoning model, its thinking is spent from
 * the same budget, and it came back with "…temperature 29°C (feels like
 * 32.9°C), humidity" — which the gate passed, because every number in it was
 * real. A truncated sentence can lose exactly the clause that mattered, so
 * the adapter refuses it and the chain moves on (or the template ships).
 */

function stubFetch(body: unknown): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

const REQ = { system: 's', user: 'u' };

test('groq: a completion cut off at the token limit is a failure, not text', async () => {
  process.env.GROQ_API_KEY ??= 'test-key';
  const restore = stubFetch({
    choices: [{ message: { content: 'It is 29°C (feels like 32.9°C), humidity' }, finish_reason: 'length' }],
  });
  try {
    const result = await groqModel('m').complete(REQ);
    assert.equal(result.kind, 'failed');
    if (result.kind === 'failed') assert.match(result.reason, /truncated/);
  } finally {
    restore();
  }
});

test('groq: a completion that stopped by itself is returned', async () => {
  process.env.GROQ_API_KEY ??= 'test-key';
  const restore = stubFetch({ choices: [{ message: { content: 'It is 29°C.' }, finish_reason: 'stop' }] });
  try {
    const result = await groqModel('m').complete(REQ);
    assert.equal(result.kind, 'ok');
    if (result.kind === 'ok') assert.equal(result.text, 'It is 29°C.');
  } finally {
    restore();
  }
});

test('gemini: anything but a natural stop is a failure', async () => {
  process.env.GEMINI_API_KEY ??= 'test-key';
  const enabled = process.env.GEMINI_ENABLED;
  delete process.env.GEMINI_ENABLED;
  const restore = stubFetch({
    candidates: [{ content: { parts: [{ text: 'It is 29°C and' }] }, finishReason: 'MAX_TOKENS' }],
  });
  try {
    const result = await geminiModel('m').complete(REQ);
    assert.equal(result.kind, 'failed');
    if (result.kind === 'failed') assert.match(result.reason, /MAX_TOKENS/);
  } finally {
    restore();
    if (enabled !== undefined) process.env.GEMINI_ENABLED = enabled;
  }
});

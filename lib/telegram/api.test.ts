/**
 * How Telegram fails, and what each failure means — shared by the bot and the
 * alert channel, so they cannot disagree about it.
 */

import { strict as assert } from 'node:assert';
import test, { afterEach, beforeEach } from 'node:test';
import { apiBase, callTelegram, chatIsGone, transient, type TelegramFailure } from './api';

const fail = (status: number, description: string): TelegramFailure => ({
  ok: false,
  status,
  description,
});

test('a blocked or missing chat is gone', () => {
  assert.equal(chatIsGone(fail(403, 'Forbidden: bot was blocked by the user')), true);
  assert.equal(chatIsGone(fail(403, 'Forbidden: user is deactivated')), true);
  assert.equal(chatIsGone(fail(400, 'Bad Request: chat not found')), true);
});

test('a message Telegram could not parse is NOT a dead chat', () => {
  // Treating every 400 as gone would remove the channel and silence every
  // warning after it, over a formatting bug.
  assert.equal(chatIsGone(fail(400, "Bad Request: can't parse entities")), false);
  assert.equal(chatIsGone(fail(400, 'Bad Request: message is too long')), false);
});

test('network failures, 5xx and flood control are transient; 4xx is not', () => {
  assert.equal(transient(fail(0, 'TimeoutError')), true);
  assert.equal(transient(fail(502, 'Bad Gateway')), true);
  assert.equal(transient(fail(429, 'Too Many Requests')), true);
  assert.equal(transient(fail(400, 'Bad Request')), false);
  assert.equal(transient(fail(403, 'Forbidden')), false);
});

test('plain http is accepted only for loopback', () => {
  assert.equal(apiBase({}), 'https://api.telegram.org');
  assert.equal(apiBase({ TELEGRAM_API_BASE: 'http://127.0.0.1:8081/' }), 'http://127.0.0.1:8081');
  assert.equal(apiBase({ TELEGRAM_API_BASE: 'https://bot-api.example.com' }), 'https://bot-api.example.com');
  // A typo must not send the token across a network unencrypted.
  assert.equal(apiBase({ TELEGRAM_API_BASE: 'http://bot-api.example.com' }), 'https://api.telegram.org');
  assert.equal(apiBase({ TELEGRAM_API_BASE: 'not a url' }), 'https://api.telegram.org');
});

/* ---- the client, against a stubbed fetch ---------------------------- */

const realFetch = globalThis.fetch;
const TOKEN = '123456:TEST-token_value_that_must_never_leak';

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TELEGRAM_BOT_TOKEN;
});

test('a network error is reported by name, never with the URL that carries the token', async () => {
  globalThis.fetch = (async () => {
    throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
  }) as typeof fetch;

  const result = await callTelegram('sendMessage', { chat_id: 1, text: 'x' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.description, 'TypeError');
    assert.ok(!JSON.stringify(result).includes(TOKEN));
  }
});

test('a short retry_after is waited out and the call retried', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      return Response.json(
        { ok: false, description: 'Too Many Requests', parameters: { retry_after: 0 } },
        { status: 429 },
      );
    }
    return Response.json({ ok: true, result: { message_id: 9 } });
  }) as typeof fetch;

  const result = await callTelegram('sendMessage', {}, { retries: 1 });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test('a long retry_after is returned rather than slept through', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json(
      { ok: false, description: 'Too Many Requests', parameters: { retry_after: 30 } },
      { status: 429 },
    );
  }) as typeof fetch;

  const result = await callTelegram('sendMessage', {}, { retries: 2 });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfter, 30);
});

test('a refusal is not retried', async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 });
  }) as typeof fetch;

  await callTelegram('sendMessage', {}, { retries: 3 });
  assert.equal(calls, 1);
});

test('without a token nothing is sent', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return Response.json({ ok: true });
  }) as typeof fetch;

  const result = await callTelegram('getMe', {});
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

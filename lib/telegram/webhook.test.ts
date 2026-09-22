/**
 * The webhook's front door: who may knock, what counts as an update, and that
 * a redelivered update is handled once.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { authenticate, handleWebhook, MAX_BODY_BYTES, readUpdate, SECRET_HEADER } from './webhook';
import type { TgUpdate } from './types';

const SECRET = 'test_secret-ABC123';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/telegram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function harness() {
  const claimed = new Set<number>();
  const handled: TgUpdate[] = [];
  const deps = {
    secret: SECRET,
    claim: async (id: number) => {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    schedule: (task: () => Promise<void>) => void task(),
    handle: async (update: TgUpdate) => {
      handled.push(update);
    },
  };
  return { deps, handled };
}

const UPDATE = { update_id: 1001, message: { message_id: 1, date: 0, chat: { id: 5, type: 'private' }, text: 'hi' } };

/* ---- authentication ------------------------------------------------ */

test('the right secret is accepted', () => {
  assert.equal(authenticate(SECRET, SECRET), 'ok');
});

test('a wrong or missing secret is denied', () => {
  assert.equal(authenticate('nope', SECRET), 'denied');
  assert.equal(authenticate(`${SECRET}x`, SECRET), 'denied');
  assert.equal(authenticate('', SECRET), 'denied');
  assert.equal(authenticate(null, SECRET), 'denied');
});

test('with no secret configured the endpoint stays shut, not open', () => {
  assert.equal(authenticate(SECRET, undefined), 'unconfigured');
  assert.equal(authenticate(null, ''), 'unconfigured');
});

test('an unauthenticated request is refused before anything is handled', async () => {
  const { deps, handled } = harness();
  const res = await handleWebhook(request(UPDATE, { [SECRET_HEADER]: 'guess' }), deps);
  assert.equal(res.status, 401);

  const none = await handleWebhook(request(UPDATE), deps);
  assert.equal(none.status, 401);
  assert.equal(handled.length, 0);
});

test('an unconfigured deployment answers 503 and handles nothing', async () => {
  const { deps, handled } = harness();
  const res = await handleWebhook(request(UPDATE, { [SECRET_HEADER]: SECRET }), {
    ...deps,
    secret: undefined,
  });
  assert.equal(res.status, 503);
  assert.equal(handled.length, 0);
});

/* ---- what counts as an update --------------------------------------- */

test('malformed bodies are refused with 400', async () => {
  for (const body of ['{not json', '[]', '"text"', '{}', '{"update_id":"7"}', '{"update_id":-1}', '{"update_id":1.5}']) {
    const read = await readUpdate(request(body));
    assert.equal(read.ok, false, body);
    if (!read.ok) assert.equal(read.status, 400, body);
  }
});

test('an oversized body is refused with 413', async () => {
  const big = JSON.stringify({ update_id: 1, pad: 'x'.repeat(MAX_BODY_BYTES) });
  const read = await readUpdate(request(big));
  assert.equal(read.ok, false);
  if (!read.ok) assert.equal(read.status, 413);
});

test('an update type the bot does not know is still accepted', async () => {
  // Refusing it would make Telegram redeliver it forever.
  const read = await readUpdate(request({ update_id: 9, some_future_update: { x: 1 } }));
  assert.equal(read.ok, true);
});

/* ---- idempotency ---------------------------------------------------- */

test('a redelivered update is acknowledged and handled once', async () => {
  const { deps, handled } = harness();
  const headers = { [SECRET_HEADER]: SECRET };

  const first = await handleWebhook(request(UPDATE, headers), deps);
  const second = await handleWebhook(request(UPDATE, headers), deps);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200, 'a duplicate is still a 200, or Telegram keeps retrying');
  assert.deepEqual(await second.json(), { ok: true, duplicate: true });
  assert.equal(handled.length, 1);
});

test('the response does not wait for the work', async () => {
  const { deps } = harness();
  let scheduled: (() => Promise<void>) | null = null;
  let ran = false;

  const res = await handleWebhook(request({ update_id: 77 }, { [SECRET_HEADER]: SECRET }), {
    ...deps,
    schedule: (task) => {
      scheduled = task;
    },
    handle: async () => {
      ran = true;
    },
  });

  assert.equal(res.status, 200);
  assert.equal(ran, false, 'acknowledged before the bot ran');
  await (scheduled as unknown as () => Promise<void>)();
  assert.equal(ran, true);
});

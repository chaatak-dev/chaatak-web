/**
 * Telegram as a channel of the EXISTING alert pipeline: the same poll, the
 * same claim, the same catalogue — delivered to a chat.
 *
 * Runs the real dispatcher and the real Telegram sender against the memory
 * store and a stubbed Telegram, so it proves the wiring rather than a copy of
 * it.
 */

import { strict as assert } from 'node:assert';
import test, { afterEach, beforeEach } from 'node:test';
import { dispatchAll } from './dispatch';
import { decidePoll } from './poll';
import { createMemoryStore } from './store-memory';
import type { Subscriber, SubscriberId } from './types';
import { orangeWarning } from '../telegram/fixtures';
import type { DistrictId } from '../weather/types';

const realFetch = globalThis.fetch;
let sent: { url: string; body: Record<string, unknown> }[] = [];
let respond: () => Response = () => Response.json({ ok: true, result: { message_id: 1 } });

beforeEach(() => {
  sent = [];
  respond = () => Response.json({ ok: true, result: { message_id: 1 } });
  process.env.TELEGRAM_BOT_TOKEN = '123:test';
  delete process.env.VAPID_PUBLIC_KEY;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TELEGRAM_BOT_TOKEN;
});

function subscriber(lang: 'hi' | 'en' = 'hi'): Subscriber {
  return {
    id: '11111111-1111-4111-8111-111111111111' as SubscriberId,
    districts: ['Ghaziabad' as DistrictId],
    lang,
    channels: [{ kind: 'telegram', chatId: '7' }],
    createdAt: new Date().toISOString(),
  };
}

function decisions() {
  const warning = orangeWarning({
    validFrom: new Date(Date.now() - 3_600_000).toISOString(),
    validTo: new Date(Date.now() + 6 * 3_600_000).toISOString(),
  });
  return decidePoll({ district: warning.district, current: [warning], seen: [], now: new Date() }).decisions;
}

test('a warning for a monitored district reaches the linked chat — once', async () => {
  const store = createMemoryStore();
  const sub = subscriber('hi');
  await store.upsertSubscriber(sub);

  const first = await dispatchAll(store, decisions(), [sub]);
  // The daemon runs again ten minutes later; IMD restates the same warning.
  const second = await dispatchAll(store, decisions(), [sub]);

  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1, 'the claim, not luck, stopped the second send');
  assert.equal(sent.length, 1);

  const { url, body } = sent[0];
  assert.ok(url.endsWith('/sendMessage'));
  assert.equal(body.chat_id, '7');
  assert.equal(body.parse_mode, 'HTML');
  assert.equal(body.disable_notification, false, 'a warning makes a sound');

  // In the subscriber's alert language, from the catalogue.
  const text = String(body.text);
  assert.ok(text.includes('नारंगी चेतावनी'));
  assert.ok(text.includes('IMD की आधिकारिक चेतावनी'));
  assert.ok(text.includes('भारी वर्षा'));

  const markup = body.reply_markup as { inline_keyboard: { callback_data?: string; url?: string }[][] };
  assert.equal(markup.inline_keyboard[0][0].callback_data, 'ad:Ghaziabad');
});

test('a subscriber watching another district is not told', async () => {
  const store = createMemoryStore();
  const sub = { ...subscriber(), districts: ['Barabanki' as DistrictId] };
  await store.upsertSubscriber(sub);

  const summary = await dispatchAll(store, decisions(), [sub]);
  assert.equal(summary.considered, 0);
  assert.equal(sent.length, 0);
});

test('a message Telegram cannot parse fails the send but keeps the channel', async () => {
  const store = createMemoryStore();
  const sub = subscriber();
  await store.upsertSubscriber(sub);
  respond = () =>
    Response.json({ ok: false, description: "Bad Request: can't parse entities" }, { status: 400 });

  const summary = await dispatchAll(store, decisions(), [sub]);
  assert.equal(summary.failed, 1);
  assert.equal(summary.channelsRemoved, 0, 'a formatting fault is not a person leaving');
  const [still] = await store.subscribersForDistricts(['Ghaziabad' as DistrictId]);
  assert.equal(still.channels.length, 1);
});

test('a chat that blocked the bot is removed and not retried', async () => {
  const store = createMemoryStore();
  const sub = subscriber();
  await store.upsertSubscriber(sub);
  respond = () =>
    Response.json({ ok: false, description: 'Forbidden: bot was blocked by the user' }, { status: 403 });

  const summary = await dispatchAll(store, decisions(), [sub]);
  assert.equal(summary.channelsRemoved, 1);
  assert.equal(sent.length, 1, 'no retry against a decision');
});

test('flood control is retried after the wait Telegram names', async () => {
  const store = createMemoryStore();
  const sub = subscriber('en');
  await store.upsertSubscriber(sub);
  let calls = 0;
  respond = () => {
    calls += 1;
    return calls === 1
      ? Response.json({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 0 } }, { status: 429 })
      : Response.json({ ok: true, result: { message_id: 2 } });
  };

  const summary = await dispatchAll(store, decisions(), [sub]);
  assert.equal(summary.sent, 1);
  assert.equal(calls, 2);
  assert.ok(String(sent[1].body.text).includes('Orange warning'));
});

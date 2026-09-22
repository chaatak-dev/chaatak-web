/**
 * The bot, end to end, against a memory store and a recording Telegram.
 *
 * The pipeline is faked here on purpose: what is under test is that the bot
 * hands the right question, place, language and history TO the pipeline and
 * shows what comes back — the pipeline itself has its own tests. Accounts are
 * faked at the same seam, and `npm run verify:accounts` runs the real SQL.
 */

import { strict as assert } from 'node:assert';
import test, { beforeEach } from 'node:test';
import type { AddLocationResult, MonitoredLocation, Profile } from '../accounts/types';
import type { AnswerInput } from '../chat/answer';
import { ASK_FOR_LOCATION } from '../chat/scope';
import { DEFAULT_PREFERENCES, type LanguagePreferences } from '../i18n/preferences';
import { resetRateLimits } from '../ratelimit';
import type { DistrictId, Location } from '../weather/types';
import { answerFor, GHAZIABAD, snapshot } from './fixtures';
import { accountLabel, boundContext, createBot, isBarePlace, isGreeting, readCommand, readPlaceKey } from './bot';
import { hashLinkToken, LINK_TTL_MS, newLinkToken } from './link';
import { placeKey } from './render';
import { createMemoryTelegramStore } from './store';
import type { InlineKeyboard, TgUpdate } from './types';

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

type Call = { method: string; params: Record<string, unknown> };

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function profile(id: string, languages: Partial<LanguagePreferences> = {}): Profile {
  return {
    id,
    email: id === USER ? 'yash.sharma@gmail.com' : 'someone.else@example.com',
    name: id === USER ? 'Yash Sharma' : 'Someone Else',
    avatarUrl: null,
    lang: 'en',
    languages: { ...DEFAULT_PREFERENCES, ...languages },
  };
}

function saved(place: Location, id = '00000000-0000-4000-8000-00000000000a'): MonitoredLocation {
  return {
    id,
    slot: 1,
    placeName: place.name,
    district: (place.admin2 ?? place.name) as DistrictId,
    state: place.admin1 ?? null,
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone,
    resolvedBy: place.resolvedBy,
    endpoint: place.endpoint,
    createdAt: new Date().toISOString(),
  };
}

function harness() {
  let clock = new Date('2026-09-23T10:00:00Z');
  const now = () => clock;
  const store = createMemoryTelegramStore(now);
  const calls: Call[] = [];
  const asked: AnswerInput[] = [];
  const profiles = new Map<string, Profile>([
    [USER, profile(USER)],
    [OTHER, profile(OTHER)],
  ]);
  const locations = new Map<string, MonitoredLocation[]>();
  const added: { userId: string; place: Location }[] = [];
  const savedLanguages: { userId: string; preferences: LanguagePreferences }[] = [];
  let addResult: AddLocationResult | null = null;
  let messageId = 100;

  const bot = createBot({
    now,
    site: 'https://chaatak.test',
    store,
    async send(method, params) {
      calls.push({ method, params });
      return { ok: true, result: { message_id: messageId++ } };
    },
    async answer(input) {
      asked.push(input);
      const needsPlace =
        /near me|tomorrow\?$/.test(input.question) && !input.coords && !input.standing?.place;
      if (needsPlace) return answerFor(ASK_FOR_LOCATION.en, { snap: null, needsLocation: true });
      return answerFor(`Answer to: ${input.question}`, { chrome: input.assistant === 'hi' ? 'hi' : 'en' });
    },
    async snapshot(place) {
      return snapshot({}, place);
    },
    async resolvePlace(query) {
      if (/ghaziabad/i.test(query)) return GHAZIABAD;
      return {
        kind: 'noData',
        reason: 'unknownPlace',
        source: 'test',
        endpoint: 'test',
        checkedAt: clock.toISOString(),
        statement: { hi: 'कोई जगह नहीं मिली।', en: `No place matched "${query}".` },
      };
    },
    resolvePoint(latitude, longitude) {
      if (latitude < 6 || latitude > 38) {
        return {
          kind: 'noData',
          reason: 'unknownPlace',
          source: 'test',
          endpoint: 'test',
          checkedAt: clock.toISOString(),
          statement: { hi: 'भारत के बाहर।', en: 'Your location appears to be outside India.' },
        };
      }
      // The gazetteer's town, never the device's fix.
      void longitude;
      return GHAZIABAD;
    },
    accounts: {
      async profile(userId) {
        return profiles.get(userId) ?? null;
      },
      async locations(userId) {
        return locations.get(userId) ?? [];
      },
      async addLocation(userId, place) {
        added.push({ userId, place });
        if (addResult) return addResult;
        const list = locations.get(userId) ?? [];
        const location = saved(place, `00000000-0000-4000-8000-0000000000${10 + list.length}`);
        locations.set(userId, [...list, location]);
        return { ok: true, location };
      },
      async removeLocation(userId, id) {
        const list = locations.get(userId) ?? [];
        locations.set(userId, list.filter((l) => l.id !== id));
        return list.some((l) => l.id === id);
      },
      async saveLanguages(userId, preferences) {
        savedLanguages.push({ userId, preferences });
        profiles.set(userId, { ...profiles.get(userId)!, languages: preferences });
      },
    },
  });

  let updateId = 1;
  const from = (chatId: number, language_code = 'en') => ({
    id: chatId,
    first_name: 'Asha',
    username: `user${chatId}`,
    language_code,
  });

  return {
    bot,
    store,
    calls,
    asked,
    profiles,
    locations,
    added,
    savedLanguages,
    setAddResult: (r: AddLocationResult | null) => (addResult = r),
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    text(chatId: number, text: string, language_code = 'en'): TgUpdate {
      return {
        update_id: updateId++,
        message: {
          message_id: messageId++,
          date: 0,
          chat: { id: chatId, type: 'private' },
          from: from(chatId, language_code),
          text,
        },
      };
    },
    location(chatId: number, latitude: number, longitude: number): TgUpdate {
      return {
        update_id: updateId++,
        message: {
          message_id: messageId++,
          date: 0,
          chat: { id: chatId, type: 'private' },
          from: from(chatId),
          location: { latitude, longitude },
        },
      };
    },
    tap(chatId: number, data: string, markup?: InlineKeyboard, language_code = 'en'): TgUpdate {
      return {
        update_id: updateId++,
        callback_query: {
          id: `cb${updateId}`,
          from: from(chatId, language_code),
          data,
          message: {
            message_id: 555,
            date: 0,
            chat: { id: chatId, type: 'private' },
            ...(markup ? { reply_markup: markup } : {}),
          },
        },
      };
    },
    sent: () => calls.filter((c) => c.method === 'sendMessage'),
    last: () => [...calls].reverse().find((c) => c.method === 'sendMessage' || c.method === 'editMessageText'),
  };
}

type Harness = ReturnType<typeof harness>;

function html(call: Call | undefined): string {
  return String(call?.params.text ?? '');
}

function inline(call: Call | undefined): { text: string; callback_data?: string; url?: string }[] {
  const markup = call?.params.reply_markup as InlineKeyboard | undefined;
  return (markup?.inline_keyboard ?? []).flat() as never;
}

/** Link `chatId` to USER the way a person does it: web link, /start, Connect. */
async function link(h: Harness, chatId: number, userId = USER): Promise<void> {
  const token = newLinkToken();
  await h.store.createLinkToken(userId, hashLinkToken(token), new Date(Date.now() + LINK_TTL_MS * 1e6));
  await h.bot.handle(h.text(chatId, `/start link_${token}`));
  const connect = inline(h.last()).find((b) => b.callback_data?.startsWith('lk:'));
  assert.ok(connect, 'a Connect button was offered');
  await h.bot.handle(h.tap(chatId, connect!.callback_data!));
}

beforeEach(() => resetRateLimits());

/* ------------------------------------------------------------------ */
/* First run                                                           */
/* ------------------------------------------------------------------ */

test('/start greets, explains, and offers location with the main keyboard', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, '/start'));

  const reply = h.sent()[0];
  assert.ok(reply, 'a reply was sent');
  assert.equal(reply.params.parse_mode, 'HTML');
  assert.ok(html(reply).includes('Official IMD warnings'));
  assert.ok(html(reply).includes('weather in Ghaziabad'));
  assert.ok(html(reply).includes('https://chaatak.test/?connect=telegram'), 'a guest is invited to connect');

  const keyboard = reply.params.reply_markup as { keyboard: { request_location?: boolean }[][] };
  assert.equal(keyboard.keyboard[0][0].request_location, true);
  assert.equal(h.asked.length, 0, 'no model or pipeline call for /start');
});

test('a greeting is answered as a greeting, not looked up as a place', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, 'hello'));
  assert.equal(h.asked.length, 0);
  assert.ok(html(h.sent()[0]).includes('Official IMD warnings'));

  assert.equal(isGreeting('Namaste 🙏'), true);
  assert.equal(isGreeting('नमस्ते'), true);
  assert.equal(isGreeting('hello Delhi'), false);
});

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

test('a weather question goes through the shared pipeline and its answer is shown', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, 'weather in Ghaziabad'));

  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0].question, 'weather in Ghaziabad');
  assert.equal(h.asked[0].assistant, 'auto', 'a guest mirrors, as on the web');
  assert.equal(h.asked[0].coords, null);

  assert.ok(h.calls.some((c) => c.method === 'sendChatAction'), 'typing is shown while it works');

  const reply = h.sent().at(-1)!;
  assert.ok(html(reply).includes('Answer to: weather in Ghaziabad'));
  assert.ok(html(reply).includes('📍 Ghaziabad, Uttar Pradesh'));
  assert.ok(inline(reply).some((b) => b.callback_data === `wx:${placeKey(GHAZIABAD)}`));

  const context = (await h.store.readChat(7))!.context;
  assert.equal(context.standing?.place, 'Ghaziabad', 'the next question can follow on');
  assert.equal(context.history?.length, 2);
});

test('the conversation carries into the next question', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, 'weather in Ghaziabad'));
  await h.bot.handle(h.text(7, 'and tomorrow?'));

  assert.equal(h.asked[1].standing?.place, 'Ghaziabad');
  assert.equal(h.asked[1].history.length, 2);
});

test('a stale conversation is let go rather than inherited', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, 'weather in Ghaziabad'));
  h.advance(13 * 60 * 60 * 1000);
  await h.bot.handle(h.text(7, 'and tomorrow?'));

  assert.equal(h.asked[1].standing, null);
  assert.equal(h.asked[1].history.length, 0);
});

/* ------------------------------------------------------------------ */
/* Location                                                            */
/* ------------------------------------------------------------------ */

test('"weather near me" asks for a place, and a shared location answers it', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, 'weather near me'));

  assert.equal(html(h.sent().at(-1)), ASK_FOR_LOCATION.en);
  assert.equal((await h.store.readChat(7))!.context.pending?.question, 'weather near me');

  await h.bot.handle(h.location(7, 28.61234, 77.2091));

  const second = h.asked.at(-1)!;
  assert.equal(second.question, 'weather near me', 'the waiting question, not a new one');
  assert.deepEqual(second.coords, { latitude: 28.61234, longitude: 77.2091 });
  assert.ok(h.calls.some((c) => c.method === 'sendChatAction' && c.params.action === 'find_location'));

  const context = (await h.store.readChat(7))!.context;
  assert.equal(context.pending, null, 'answered, so no longer waiting');
  assert.ok(
    !JSON.stringify(context).includes('28.61234'),
    'the device’s coordinate is never kept — only the canonical place',
  );
});

test('a shared location on its own gets that place’s weather card, with no model call', async () => {
  const h = harness();
  await h.bot.handle(h.location(7, 28.61234, 77.2091));

  assert.equal(h.asked.length, 0);
  const card = h.sent().at(-1)!;
  assert.ok(html(card).includes('<b>Ghaziabad</b>'));
  assert.ok(html(card).includes('31.27°C'));
  assert.equal((await h.store.readChat(7))!.context.standing?.place, 'Ghaziabad');
});

test('a location outside India is said so, not guessed', async () => {
  const h = harness();
  await h.bot.handle(h.location(7, 51.5, -0.12));
  assert.ok(html(h.sent().at(-1)).includes('outside India'));
});

test('a place typed in reply to "which place?" answers the waiting question', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, 'will it rain tomorrow?'));
  await h.bot.handle(h.text(7, 'Ghaziabad'));

  const second = h.asked.at(-1)!;
  assert.equal(second.question, 'will it rain tomorrow?');
  assert.equal(second.standing?.place, 'Ghaziabad');

  assert.equal(isBarePlace({ kind: 'query', intent: 'current', place: 'Ghaziabad', placeWasImplied: false, timeWindow: { kind: 'now' }, variable: 'all', servedBy: 'pattern' }), true);
  assert.equal(isBarePlace({ kind: 'query', intent: 'forecast', place: 'Ghaziabad', placeWasImplied: false, timeWindow: { kind: 'day', offset: 1 }, variable: 'all', servedBy: 'pattern' }), false);
});

test('a linked account’s saved places answer "which place?" in one tap', async () => {
  const h = harness();
  await link(h, 7);
  h.locations.set(USER, [saved(GHAZIABAD)]);

  await h.bot.handle(h.text(7, 'will it rain tomorrow?'));
  const offer = inline(h.sent().at(-1)).find((b) => b.callback_data?.startsWith('pq:'));
  assert.equal(offer?.text, 'Ghaziabad');

  await h.bot.handle(h.tap(7, offer!.callback_data!));
  const second = h.asked.at(-1)!;
  assert.equal(second.question, 'will it rain tomorrow?');
  assert.deepEqual(second.coords, { latitude: GHAZIABAD.latitude, longitude: GHAZIABAD.longitude });
});

test('/weather with a place gives its card; without one it asks', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, '/weather Ghaziabad'));
  assert.ok(html(h.sent().at(-1)).includes('<b>Ghaziabad</b>'));

  await h.bot.handle(h.text(8, '/weather'));
  assert.ok(html(h.sent().at(-1)).includes('Which place?'));

  await h.bot.handle(h.text(9, '/weather Atlantis'));
  assert.ok(html(h.sent().at(-1)).includes('No place matched'));
});

/* ------------------------------------------------------------------ */
/* Linking                                                             */
/* ------------------------------------------------------------------ */

test('a link asks for confirmation, naming the account without disclosing it', async () => {
  const h = harness();
  const token = newLinkToken();
  await h.store.createLinkToken(USER, hashLinkToken(token), new Date(Date.now() + LINK_TTL_MS * 1e6));

  await h.bot.handle(h.text(7, `/start link_${token}`));
  const confirm = h.sent().at(-1)!;
  assert.ok(html(confirm).includes('Yash (ya•••@gmail.com)'));
  assert.ok(!html(confirm).includes('yash.sharma@gmail.com'));
  assert.equal((await h.store.readChat(7))?.userId ?? null, null, 'nothing is linked before Connect');

  const connect = inline(confirm).find((b) => b.callback_data?.startsWith('lk:'))!;
  await h.bot.handle(h.tap(7, connect.callback_data!));

  assert.equal((await h.store.readChat(7))!.userId, USER);
  assert.deepEqual(h.store.channels.get(USER), [7], 'alerts now reach this chat');
  const edited = h.calls.filter((c) => c.method === 'editMessageText').at(-1);
  assert.ok(html(edited).includes('Connected.'), 'the confirmation itself becomes the outcome');
});

test('a link works once: a replay finds nothing', async () => {
  const h = harness();
  const token = newLinkToken();
  await h.store.createLinkToken(USER, hashLinkToken(token), new Date(Date.now() + LINK_TTL_MS * 1e6));

  await h.bot.handle(h.text(7, `/start link_${token}`));
  const connect = inline(h.sent().at(-1)).find((b) => b.callback_data?.startsWith('lk:'))!;
  await h.bot.handle(h.tap(7, connect.callback_data!));

  // The same link, again, from the same chat and from another.
  await h.bot.handle(h.text(7, `/start link_${token}`));
  assert.ok(html(h.sent().at(-1)).includes('expired or has already been used'));
  await h.bot.handle(h.text(8, `/start link_${token}`));
  assert.ok(html(h.sent().at(-1)).includes('expired or has already been used'));
  assert.equal((await h.store.readChat(8))?.userId ?? null, null);

  // And pressing Connect a second time does nothing more.
  await h.bot.handle(h.tap(7, connect.callback_data!));
  assert.ok(html(h.last()).includes('expired or has already been used'));
});

test('a link is bound to the first chat that opens it', async () => {
  const h = harness();
  const token = newLinkToken();
  await h.store.createLinkToken(USER, hashLinkToken(token), new Date(Date.now() + LINK_TTL_MS * 1e6));

  await h.bot.handle(h.text(7, `/start link_${token}`));
  const connect = inline(h.sent().at(-1)).find((b) => b.callback_data?.startsWith('lk:'))!;

  // Someone the link was forwarded to, in another chat.
  await h.bot.handle(h.text(8, `/start link_${token}`));
  assert.ok(html(h.sent().at(-1)).includes('expired or has already been used'));
  // …even pressing a copy of the first chat's button.
  await h.bot.handle(h.tap(8, connect.callback_data!));
  assert.equal((await h.store.readChat(8))?.userId ?? null, null);

  await h.bot.handle(h.tap(7, connect.callback_data!));
  assert.equal((await h.store.readChat(7))!.userId, USER);
});

test('an expired link links nothing', async () => {
  const h = harness();
  const token = newLinkToken();
  await h.store.createLinkToken(USER, hashLinkToken(token), new Date(new Date('2026-09-23T10:00:00Z').getTime() + LINK_TTL_MS));

  h.advance(LINK_TTL_MS + 1_000);
  await h.bot.handle(h.text(7, `/start link_${token}`));
  assert.ok(html(h.sent().at(-1)).includes('expired'));
  assert.equal((await h.store.readChat(7))?.userId ?? null, null);
});

test('a link that expires between opening and confirming links nothing', async () => {
  const h = harness();
  const token = newLinkToken();
  await h.store.createLinkToken(USER, hashLinkToken(token), new Date(new Date('2026-09-23T10:00:00Z').getTime() + LINK_TTL_MS));

  await h.bot.handle(h.text(7, `/start link_${token}`));
  const connect = inline(h.sent().at(-1)).find((b) => b.callback_data?.startsWith('lk:'))!;
  h.advance(LINK_TTL_MS + 1_000);
  await h.bot.handle(h.tap(7, connect.callback_data!));
  assert.equal((await h.store.readChat(7))?.userId ?? null, null);
});

test('a chat linked to one account is never switched to another by a link', async () => {
  const h = harness();
  await link(h, 7, OTHER);

  const token = newLinkToken();
  await h.store.createLinkToken(USER, hashLinkToken(token), new Date(Date.now() + LINK_TTL_MS * 1e6));
  await h.bot.handle(h.text(7, `/start link_${token}`));

  assert.ok(html(h.sent().at(-1)).includes('connected to a different Chaatak account'));
  assert.equal((await h.store.readChat(7))!.userId, OTHER);
  assert.ok(!inline(h.sent().at(-1)).some((b) => b.callback_data?.startsWith('lk:')));
});

test('connecting a second Telegram moves the link, and the first is told', async () => {
  const h = harness();
  await link(h, 7);
  await link(h, 8);

  assert.equal((await h.store.readChat(7))!.userId, null);
  assert.equal((await h.store.readChat(8))!.userId, USER);
  assert.deepEqual(h.store.channels.get(USER), [8]);
  assert.ok(
    h.sent().some((c) => c.params.chat_id === 7 && html(c).includes('has been disconnected')),
    'the replaced chat hears about it',
  );
});

test('cancelling a link leaves everything as it was', async () => {
  const h = harness();
  const token = newLinkToken();
  await h.store.createLinkToken(USER, hashLinkToken(token), new Date(Date.now() + LINK_TTL_MS * 1e6));
  await h.bot.handle(h.text(7, `/start link_${token}`));
  const cancel = inline(h.sent().at(-1)).find((b) => b.callback_data?.startsWith('lx:'))!;

  await h.bot.handle(h.tap(7, cancel.callback_data!));
  assert.equal((await h.store.readChat(7))?.userId ?? null, null);
  assert.equal(h.store.tokens.size, 0, 'the token is gone');
  assert.ok(html(h.last()).includes('Nothing was changed'));
});

/* ------------------------------------------------------------------ */
/* Monitored locations and alerts                                      */
/* ------------------------------------------------------------------ */

test('"Get alerts" adds a monitored location through the account’s own store', async () => {
  const h = harness();
  await link(h, 7);
  await h.bot.handle(h.location(7, 28.6, 77.4));

  const card = h.sent().at(-1)!;
  const watch = inline(card).find((b) => b.callback_data?.startsWith('wa:'))!;
  assert.ok(watch, 'offered on the card');

  await h.bot.handle(h.tap(7, watch.callback_data!, card.params.reply_markup as InlineKeyboard));

  assert.deepEqual(h.added, [{ userId: USER, place: GHAZIABAD }]);
  const toast = h.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!;
  assert.match(String(toast.params.text), /Watching Ghaziabad/);
  const edited = h.calls.find((c) => c.method === 'editMessageReplyMarkup')!;
  assert.ok(inline(edited).some((b) => b.text === '✓ Watching Ghaziabad'));
});

test('the three-place limit and the one-district rule come back as they are', async () => {
  const h = harness();
  await link(h, 7);
  await h.bot.handle(h.location(7, 28.6, 77.4));
  const watch = inline(h.sent().at(-1)).find((b) => b.callback_data?.startsWith('wa:'))!;

  h.setAddResult({ ok: false, reason: 'full' });
  await h.bot.handle(h.tap(7, watch.callback_data!));
  const toast = h.calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)!;
  assert.match(String(toast.params.text), /Three places is the limit/);
  assert.equal(toast.params.show_alert, true);
});

test('a guest who taps "Get alerts" is told how, and nothing is saved', async () => {
  const h = harness();
  await h.bot.handle(h.location(7, 28.6, 77.4));
  const watch = inline(h.sent().at(-1)).find((b) => b.callback_data?.startsWith('wa:'))!;

  await h.bot.handle(h.tap(7, watch.callback_data!));
  assert.equal(h.added.length, 0);
  const reply = h.sent().at(-1)!;
  assert.ok(html(reply).includes('need a Chaatak account'));
  assert.equal(inline(reply)[0].url, 'https://chaatak.test/?connect=telegram');
});

test('pausing and resuming alerts changes where the daemon delivers', async () => {
  const h = harness();
  await link(h, 7);
  assert.deepEqual(h.store.channels.get(USER), [7]);

  await h.bot.handle(h.tap(7, 'al:off'));
  assert.deepEqual(h.store.channels.get(USER), []);
  await h.bot.handle(h.tap(7, 'al:on'));
  assert.deepEqual(h.store.channels.get(USER), [7]);
});

test('blocking the bot pauses alerts at once; unblocking does not resume them by itself', async () => {
  const h = harness();
  await link(h, 7);

  const member = (status: string): TgUpdate => ({
    update_id: 9_000 + status.length,
    my_chat_member: {
      chat: { id: 7, type: 'private' },
      from: { id: 7 },
      new_chat_member: { status },
    },
  });

  await h.bot.handle(member('kicked'));
  assert.deepEqual(h.store.channels.get(USER), []);
  await h.bot.handle(member('member'));
  assert.deepEqual(h.store.channels.get(USER), []);
});

test('disconnecting from Telegram stops alerts there', async () => {
  const h = harness();
  await link(h, 7);
  await h.bot.handle(h.tap(7, 'ul:ask'));
  assert.ok(html(h.last()).includes('Disconnect this Telegram'));
  await h.bot.handle(h.tap(7, 'ul:yes'));

  assert.equal((await h.store.readChat(7))!.userId, null);
  assert.deepEqual(h.store.channels.get(USER), []);
});

/* ------------------------------------------------------------------ */
/* Language                                                            */
/* ------------------------------------------------------------------ */

test('a linked account’s assistant language reaches the pipeline and the chrome', async () => {
  const h = harness();
  h.profiles.set(USER, profile(USER, { assistant: 'hi' }));
  await link(h, 7);

  await h.bot.handle(h.text(7, 'weather in Ghaziabad'));
  assert.equal(h.asked.at(-1)!.assistant, 'hi');

  await h.bot.handle(h.text(7, '/help'));
  assert.match(html(h.sent().at(-1)), /कैसे पूछें/);
});

test('Telegram’s language is a first guess, and the conversation overrides it', async () => {
  const h = harness();
  await h.bot.handle(h.text(7, '/help', 'hi'));
  assert.match(html(h.sent().at(-1)), /कैसे पूछें/, 'a Hindi Telegram gets Hindi before anything is said');

  await h.bot.handle(h.text(7, 'weather in Ghaziabad', 'hi'));
  await h.bot.handle(h.text(7, '/help', 'hi'));
  assert.match(html(h.sent().at(-1)), /How to ask/, 'they wrote in English, so English it is');
});

test('changing the reply language writes the account’s own assistant preference, and only it', async () => {
  const h = harness();
  h.profiles.set(USER, profile(USER, { ui: 'en', voice: 'ta' }));
  await link(h, 7);

  await h.bot.handle(h.tap(7, 'lg:hi'));
  assert.deepEqual(h.savedLanguages.at(-1), {
    userId: USER,
    preferences: { ui: 'en', assistant: 'hi', voice: 'ta' },
  });

  // Nothing Telegram-only, and nothing for a guest.
  await h.bot.handle(h.tap(8, 'lg:hi'));
  assert.equal(h.savedLanguages.length, 1);
});

/* ------------------------------------------------------------------ */
/* Robustness                                                          */
/* ------------------------------------------------------------------ */

test('group chats are ignored', async () => {
  const h = harness();
  await h.bot.handle({
    update_id: 1,
    message: { message_id: 1, date: 0, chat: { id: -100, type: 'group' }, text: 'weather in Delhi' },
  });
  assert.equal(h.calls.length, 0);
});

test('a flood gets one "slow down" and then silence', async () => {
  const h = harness();
  for (let n = 0; n < 23; n++) await h.bot.handle(h.text(7, `weather in Ghaziabad ${n}`));
  assert.equal(h.asked.length, 20);
  assert.equal(h.sent().filter((c) => html(c).includes('a lot of messages')).length, 1);
});

test('when the database is down, the question is still answered', async () => {
  const h = harness();
  h.store.readChat = async () => {
    throw new Error('connection refused');
  };
  h.store.writeContext = async () => {
    throw new Error('connection refused');
  };

  await h.bot.handle(h.text(7, 'weather in Ghaziabad'));
  assert.ok(html(h.sent().at(-1)).includes('Answer to: weather in Ghaziabad'));
});

test('something the bot cannot read gets a short, useful reply', async () => {
  const h = harness();
  await h.bot.handle({
    update_id: 1,
    message: { message_id: 1, date: 0, chat: { id: 7, type: 'private' }, voice: {} },
  });
  assert.ok(html(h.sent().at(-1)).includes('typed questions and shared locations'));
});

test('an unknown button is answered, never left spinning', async () => {
  const h = harness();
  await h.bot.handle(h.tap(7, 'zz:whatever'));
  assert.ok(h.calls.some((c) => c.method === 'answerCallbackQuery'));
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

test('commands are read with or without the bot’s name', () => {
  assert.deepEqual(readCommand('/weather Delhi'), { command: 'weather', arg: 'Delhi' });
  assert.deepEqual(readCommand('/Weather@ChaatakBot  Barabanki tomorrow'), {
    command: 'weather',
    arg: 'Barabanki tomorrow',
  });
  assert.equal(readCommand('weather'), null);
});

test('a place key from a button is shape-checked', () => {
  assert.deepEqual(readPlaceKey('28.6692,77.4538'), { latitude: 28.6692, longitude: 77.4538 });
  assert.equal(readPlaceKey('28.6692,77.4538;drop'), null);
  assert.equal(readPlaceKey('99.0000,77.4538'), null);
  assert.equal(readPlaceKey(''), null);
});

test('context is bounded', () => {
  const at = new Date('2026-09-23T10:00:00Z');
  const long = 'x'.repeat(5_000);
  const bounded = boundContext(
    {
      at: at.toISOString(),
      history: Array.from({ length: 30 }, (_, n) => ({
        id: String(n),
        role: 'user' as const,
        text: long,
        lang: 'en' as const,
        at: at.toISOString(),
      })),
      places: Array.from({ length: 30 }, () => GHAZIABAD),
    },
    at,
  );
  assert.equal(bounded.history!.length, 8);
  assert.equal(bounded.history![0].text.length, 600);
  assert.equal(bounded.places!.length, 8);
});

test('the account is named by first name and masked email', () => {
  assert.equal(accountLabel({ name: 'Yash Sharma', email: 'yash.sharma@gmail.com' }), 'Yash (ya•••@gmail.com)');
  assert.equal(accountLabel({ name: null, email: 'ab@x.in' }), 'a•••@x.in');
  assert.equal(accountLabel(null), '—');
});

test('someone who arrives through the link still gets the welcome and the 📍 key', async () => {
  const h = harness();
  await link(h, 7);
  const welcome = h.sent().find((c) => html(c).includes('Ask the way you would ask a person'));
  assert.ok(welcome, 'the welcome followed the connection');
  const keyboard = welcome!.params.reply_markup as { keyboard: { request_location?: boolean }[][] };
  assert.equal(keyboard.keyboard[0][0].request_location, true);
  assert.ok(!html(welcome).includes('connect=telegram'), 'not invited to connect what they just connected');

  // A chat that already knew the bot is not welcomed twice.
  const again = harness();
  await again.bot.handle(again.text(8, 'weather in Ghaziabad'));
  await link(again, 8);
  assert.equal(again.sent().filter((c) => html(c).includes('Ask the way you would ask a person')).length, 0);
});

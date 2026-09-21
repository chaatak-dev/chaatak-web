/**
 * Exercises the account store against the real database.
 *
 *   npm run verify:accounts
 *
 * This calls the SAME FUNCTIONS the API routes call — not a SQL
 * re-implementation of them. That distinction is the point: a re-implementation
 * tests the schema and agrees with itself, while this one found that
 * `syncSubscriber` bound one parameter as both text and uuid and would have
 * thrown the first time anybody switched alerts on.
 *
 * It creates a throwaway auth user, runs every flow an account has, and
 * deletes the user at the end — including after a failure. Nothing it writes
 * outlives the run.
 *
 * Exits non-zero on the first failed assertion.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const { db, closeDb } = await import('../lib/db/pool.js');
const store = await import('../lib/accounts/store.js');
const { conversationTitle } = await import('../lib/accounts/title.js');
const { resolvePoint } = await import('../lib/weather/point.js');
import type { ConversationId } from '../lib/accounts/types.js';
import type { Location } from '../lib/weather/types.js';

let checks = 0;
let failures = 0;

function assert(condition: unknown, label: string, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}`);
    if (detail) console.log(`      ${detail}`);
  }
}

const userId = randomUUID();
const email = `account-check-${userId.slice(0, 8)}@example.invalid`;

function place(name: string, district: string, state: string): Location {
  return {
    name,
    admin1: state,
    admin2: district,
    country: 'India',
    countryCode: 'IN',
    latitude: 26.9,
    longitude: 81.2,
    timezone: 'Asia/Kolkata',
    resolvedBy: 'test',
    endpoint: 'test',
  };
}

try {
  await db().query(`insert into auth.users (id, email) values ($1, $2)`, [userId, email]);

  /* ---- profile ---------------------------------------------------- */

  console.log('\nprofile');

  await store.upsertProfile({
    id: userId,
    email,
    name: 'Test Person',
    avatarUrl: 'https://example.invalid/a.png',
  });

  let profile = await store.readProfile(userId);
  assert(profile?.name === 'Test Person', 'the profile is mirrored from the identity');
  assert(profile?.lang === 'hi', 'the reply language defaults to Hindi');

  // Signing in again with a changed display name follows the account.
  await store.upsertProfile({
    id: userId,
    email,
    name: 'Renamed Person',
    avatarUrl: null,
  });
  profile = await store.readProfile(userId);
  assert(profile?.name === 'Renamed Person', 'a changed name follows on the next sign-in');

  await store.upsertProfile({ id: userId, email, name: 'Renamed Person', avatarUrl: null }, 'en');
  profile = await store.readProfile(userId);
  assert(profile?.lang === 'en', 'the reply language can be set');

  /* ---- conversations and messages --------------------------------- */

  console.log('\nconversations and messages');

  const title = conversationTitle({
    question: 'Will it rain in Ghaziabad tomorrow?',
    place: 'Ghaziabad',
    intent: 'forecast',
    timeWindow: { kind: 'day', offset: 1 },
    variable: 'rain',
    lang: 'en',
  });

  const conversation = await store.createConversation(userId, { title });
  assert(conversation.title === 'Ghaziabad rain tomorrow', 'a conversation is named from its first question', `got: ${conversation.title}`);

  const turns = [
    {
      clientId: 'turn-1:q',
      role: 'user' as const,
      text: 'Will it rain in Ghaziabad tomorrow?',
      lang: 'en' as const,
      at: '2026-09-21T10:00:00.000Z',
    },
    {
      clientId: 'turn-1:a',
      role: 'assistant' as const,
      text: 'Rain is likely, around 12 mm.',
      lang: 'en' as const,
      at: '2026-09-21T10:00:00.001Z',
      grounding: {
        place: { name: 'Ghaziabad' },
        provenance: { source: 'IMD', issuedAt: '2026-09-21T09:00:00.000Z' },
      } as never,
    },
  ];

  await store.appendTurns(userId, conversation.id, turns, title);

  let messages = await store.conversationMessages(userId, conversation.id);
  assert(messages?.length === 2, 'both turns are stored', `got ${messages?.length}`);
  assert(messages?.[0].role === 'user', 'the question comes first');
  assert(messages?.[1].role === 'assistant', 'the answer comes second');
  assert(
    Boolean(messages?.[1].grounding),
    'the answer keeps the provenance it shipped with',
  );

  // The idempotency property. A retry after a timeout must not double the turn.
  await store.appendTurns(userId, conversation.id, turns, title);
  messages = await store.conversationMessages(userId, conversation.id);
  assert(messages?.length === 2, 'the same turn written twice is stored once', `got ${messages?.length}`);

  const renamed = await store.renameConversation(userId, conversation.id, 'My rain chat');
  assert(renamed?.title === 'My rain chat', 'a conversation can be renamed');

  // A title is written once and never overwritten by a later turn.
  await store.appendTurns(
    userId,
    conversation.id,
    [
      {
        clientId: 'turn-2:q',
        role: 'user',
        text: 'and the day after?',
        lang: 'en',
        at: '2026-09-21T10:05:00.000Z',
      },
    ],
    'A different title',
  );
  const after = await store.listConversations(userId);
  assert(
    after[0].title === 'My rain chat',
    'a later turn does not rename the conversation',
    `got: ${after[0].title}`,
  );

  /* ---- ownership -------------------------------------------------- */

  console.log('\nownership');

  const stranger = randomUUID();
  const strangerView = await store.conversationMessages(
    stranger,
    conversation.id,
  );
  assert(
    strangerView === null,
    "another account reading this conversation gets nothing",
  );
  assert(
    (await store.renameConversation(stranger, conversation.id, 'stolen')) === null,
    'another account cannot rename it',
  );
  assert(
    (await store.deleteConversation(stranger, conversation.id)) === false,
    'another account cannot delete it',
  );
  assert(
    (await store.conversationMessages(userId, conversation.id))?.length === 3,
    'and the conversation is untouched by any of that',
  );

  const missing = await store.conversationMessages(userId, randomUUID() as ConversationId);
  assert(missing === null, 'a conversation that does not exist reads as absent');

  /* ---- monitored locations ---------------------------------------- */

  console.log('\nmonitored locations');

  const first = await store.addLocation(userId, place('Barabanki', 'Barabanki', 'Uttar Pradesh'));
  assert(first.ok && first.location.slot === 1, 'the first place takes slot 1');

  const second = await store.addLocation(userId, place('Nashik', 'Nashik', 'Maharashtra'));
  assert(second.ok && second.location.slot === 2, 'the second takes slot 2');

  const third = await store.addLocation(userId, place('Jaipur', 'Jaipur', 'Rajasthan'));
  assert(third.ok && third.location.slot === 3, 'the third takes slot 3');

  const fourth = await store.addLocation(userId, place('Surat', 'Surat', 'Gujarat'));
  assert(
    !fourth.ok && fourth.reason === 'full',
    'the fourth is refused as full',
    JSON.stringify(fourth),
  );

  // The district is the identity, so another village in a district already
  // watched would spend a slot on identical alerts.
  const duplicate = await store.addLocation(
    userId,
    place('Some village', 'Barabanki', 'Uttar Pradesh'),
  );
  assert(
    !duplicate.ok && duplicate.reason === 'duplicate',
    'the same district twice is refused as a duplicate',
    JSON.stringify(duplicate),
  );
  assert(
    !duplicate.ok &&
      duplicate.reason === 'duplicate' &&
      duplicate.existing.placeName === 'Barabanki',
    'and it names the place already covering that district',
  );

  // Case and spelling are normalised the same way the gazetteer does it.
  assert(
    store.districtKey('Barabanki District') === store.districtKey('barabanki'),
    'the duplicate key normalises spelling and the district suffix',
  );

  let locations = await store.listLocations(userId);
  assert(locations.length === 3, 'three places are saved', `got ${locations.length}`);

  assert(
    (await store.removeLocation(stranger, locations[0].id)) === false,
    'another account cannot remove a place',
  );

  assert(await store.removeLocation(userId, locations[2].id), 'a place can be removed');
  locations = await store.listLocations(userId);
  assert(locations.length === 2, 'two remain');

  const replacement = await store.addLocation(userId, place('Surat', 'Surat', 'Gujarat'));
  assert(
    replacement.ok && replacement.location.slot === 3,
    'the freed slot is reused',
    JSON.stringify(replacement),
  );

  /* ---- the bridge to the alert daemon ------------------------------ */

  console.log('\nthe alert daemon subscription');

  let status = await store.alertStatus(userId);
  assert(!status.enabled, 'saving places does not switch alerts on');

  let row = await db().query(`select districts from subscribers where id = $1`, [userId]);
  assert(
    row.rows.length === 0,
    'and no subscriber row exists while there is no way to reach this person',
    JSON.stringify(row.rows),
  );

  await store.addChannel(
    userId,
    { kind: 'webpush', endpoint: 'https://push.example.invalid/abc', p256dh: 'k', auth: 'a' },
    'hi',
  );

  status = await store.alertStatus(userId);
  assert(status.enabled && status.channels.webpush === 1, 'registering a device switches them on');

  row = await db().query(`select districts, lang, user_id from subscribers where id = $1`, [userId]);
  assert(row.rows.length === 1, 'the subscriber row the daemon reads now exists');
  assert(
    (row.rows[0].districts as string[]).sort().join(',') === 'Barabanki,Nashik,Surat',
    'and it carries exactly the districts being watched',
    JSON.stringify(row.rows[0].districts),
  );
  assert(row.rows[0].user_id === userId, 'the row is owned by the account');

  // A second registration of the same endpoint — a reload, a second tab.
  await store.addChannel(
    userId,
    { kind: 'webpush', endpoint: 'https://push.example.invalid/abc', p256dh: 'k', auth: 'a' },
    'hi',
  );
  status = await store.alertStatus(userId);
  assert(
    status.channels.webpush === 1,
    'the same device registering twice is one channel, not two alerts',
    JSON.stringify(status),
  );

  await store.removeLocation(userId, locations[0].id);
  row = await db().query(`select districts from subscribers where id = $1`, [userId]);
  assert(
    !(row.rows[0].districts as string[]).includes('Barabanki'),
    'removing a place stops the daemon polling for it',
    JSON.stringify(row.rows[0].districts),
  );

  await store.removeWebPushChannel(userId, 'https://push.example.invalid/abc');
  status = await store.alertStatus(userId);
  assert(!status.enabled, 'removing the last device switches alerts off');

  row = await db().query(`select districts from subscribers where id = $1`, [userId]);
  assert(
    (row.rows[0].districts as string[]).length === 0,
    'and the daemon stops polling for an account it cannot reach',
    JSON.stringify(row.rows[0].districts),
  );

  const stillSaved = await store.listLocations(userId);
  assert(
    stillSaved.length === 2,
    'while the saved places themselves are untouched',
    `got ${stillSaved.length}`,
  );

  /* ---- a coordinate resolves through the same pipeline ------------- */

  console.log('\nsaving where you are');

  const here = resolvePoint(28.6692, 77.4538);
  assert(!('kind' in here), 'a coordinate resolves to a place');

  if (!('kind' in here)) {
    const saved = await store.addLocation(userId, here);
    assert(saved.ok, 'and can be saved', JSON.stringify(saved));

    if (saved.ok) {
      assert(
        saved.location.latitude !== 28.6692,
        "what is stored is the town's coordinate, not the device's",
        `${saved.location.latitude}`,
      );
      assert(saved.location.district === 'Ghaziabad', 'with the district IMD warns on');
    }
  }

  /* ---- deleting the account ---------------------------------------- */

  console.log('\ndeleting the account');

  await store.addChannel(
    userId,
    { kind: 'telegram', chatId: '12345' },
    'hi',
  );

  await store.deleteAccount(userId);

  for (const [table, column] of [
    ['profiles', 'id'],
    ['conversations', 'user_id'],
    ['messages', 'user_id'],
    ['monitored_locations', 'user_id'],
    ['subscribers', 'id'],
    ['dispatch_claims', 'subscriber_id'],
    ['dispatch_log', 'subscriber_id'],
  ]) {
    const { rows } = await db().query(
      `select count(*)::int as n from ${table} where ${column} = $1`,
      [userId],
    );
    assert(rows[0].n === 0, `${table}: nothing left behind`, `${rows[0].n} rows`);
  }

  const { rows: gone } = await db().query(
    `select count(*)::int as n from auth.users where id = $1`,
    [userId],
  );
  assert(gone[0].n === 0, 'the account itself is gone');
} finally {
  // Whatever happened, the throwaway account goes.
  await db()
    .query(`delete from auth.users where id = $1`, [userId])
    .catch(() => {});
  await db()
    .query(`delete from profiles where id = $1`, [userId])
    .catch(() => {});
  await closeDb();
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) {
  console.error(`\n${failures} FAILED`);
  process.exit(1);
}

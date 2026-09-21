/**
 * Proves that one account cannot reach another's data.
 *
 *   node scripts/verify-rls.mjs
 *
 * WHY THIS EXISTS AS A SCRIPT. Every table in `public` is reachable through
 * Supabase's PostgREST endpoint with the anon key that now ships in the
 * browser. Row-level security is the only thing between one account and
 * another on that path, and an RLS policy that is subtly wrong looks exactly
 * like one that is right — the app keeps working, because the app connects as
 * `postgres` and never exercises a policy at all.
 *
 * So this exercises them directly: it becomes the `authenticated` role,
 * asserts a user id the way a verified JWT would, and then tries to read and
 * write things that belong to somebody else. It also tries the same as `anon`,
 * which is what an unauthenticated request to PostgREST is.
 *
 * It creates two throwaway users, does its work, and deletes them — including
 * on failure. Nothing it writes outlives the run.
 *
 * Exits non-zero on the first failed assertion.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
let checks = 0;

function ok(label) {
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function bad(label, detail) {
  checks += 1;
  failures += 1;
  console.log(`  ✗ ${label}`);
  if (detail) console.log(`      ${detail}`);
}

function assert(condition, label, detail) {
  if (condition) ok(label);
  else bad(label, detail);
}

/**
 * Run a query as a signed-in user.
 *
 * `set local role authenticated` plus the JWT claims GUC is exactly what
 * PostgREST does per request, so a policy that passes here passes there.
 * Everything is inside one transaction and rolled back, so the role change
 * cannot leak onto a pooled connection.
 */
async function asUser(userId, sql, params = []) {
  await client.query('begin');
  try {
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await client.query('set local role authenticated');
    const result = await client.query(sql, params);
    return { ok: true, rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  } finally {
    await client.query('rollback');
  }
}

async function asAnon(sql, params = []) {
  await client.query('begin');
  try {
    await client.query('set local role anon');
    const result = await client.query(sql, params);
    return { ok: true, rows: result.rows, rowCount: result.rowCount };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  } finally {
    await client.query('rollback');
  }
}

const alice = randomUUID();
const bob = randomUUID();

await client.connect();

try {
  console.log('\nrow-level security is enabled');

  const { rows: tables } = await client.query(
    `select c.relname, c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );

  for (const table of tables) {
    assert(
      table.relrowsecurity,
      `${table.relname}`,
      'RLS is OFF — this table is readable through the public API',
    );
  }

  /* ---- two accounts, with something to protect ------------------- */

  console.log('\nsetting up two throwaway accounts');

  for (const id of [alice, bob]) {
    await client.query(
      `insert into auth.users (id, email) values ($1, $2)`,
      [id, `rls-check-${id.slice(0, 8)}@example.invalid`],
    );
    await client.query(`insert into profiles (id, email) values ($1, $2)`, [
      id,
      `rls-check-${id.slice(0, 8)}@example.invalid`,
    ]);
  }

  const { rows: conversations } = await client.query(
    `insert into conversations (user_id, title)
     values ($1, 'Alice private'), ($2, 'Bob private')
     returning id, user_id`,
  [alice, bob]);

  const aliceChat = conversations.find((c) => c.user_id === alice).id;
  const bobChat = conversations.find((c) => c.user_id === bob).id;

  await client.query(
    `insert into messages (conversation_id, user_id, role, text)
     values ($1, $2, 'user', 'alice secret'), ($3, $4, 'user', 'bob secret')`,
    [aliceChat, alice, bobChat, bob],
  );

  await client.query(
    `insert into monitored_locations
       (user_id, slot, place_name, district, district_key, latitude, longitude)
     values ($1, 1, 'Barabanki', 'Barabanki', 'barabanki', 26.92, 81.19),
            ($2, 1, 'Ghaziabad', 'Ghaziabad', 'ghaziabad', 28.67, 77.45)`,
    [alice, bob],
  );

  console.log('  ✓ two accounts, each with a conversation, a message and a place');

  /* ---- one account cannot see the other -------------------------- */

  console.log('\none account cannot read another');

  let result = await asUser(alice, `select id, title from conversations`);
  assert(
    result.ok && result.rows.length === 1 && result.rows[0].id === aliceChat,
    'conversations: sees only its own',
    result.ok ? `saw ${result.rows.length} rows` : result.message,
  );

  result = await asUser(alice, `select id from conversations where id = $1`, [bobChat]);
  assert(
    result.ok && result.rows.length === 0,
    "conversations: asking for another account's id by hand returns nothing",
    result.ok ? `saw ${result.rows.length} rows` : result.message,
  );

  result = await asUser(alice, `select text from messages`);
  assert(
    result.ok && result.rows.length === 1 && result.rows[0].text === 'alice secret',
    'messages: sees only its own',
    result.ok ? JSON.stringify(result.rows) : result.message,
  );

  result = await asUser(alice, `select place_name from monitored_locations`);
  assert(
    result.ok && result.rows.length === 1 && result.rows[0].place_name === 'Barabanki',
    'monitored_locations: sees only its own',
    result.ok ? JSON.stringify(result.rows) : result.message,
  );

  result = await asUser(alice, `select id, email from profiles`);
  assert(
    result.ok && result.rows.length === 1 && result.rows[0].id === alice,
    'profiles: sees only its own',
    result.ok ? `saw ${result.rows.length} rows` : result.message,
  );

  /* ---- and cannot write into it ---------------------------------- */

  console.log('\none account cannot write into another');

  result = await asUser(alice, `update conversations set title = 'taken' where id = $1`, [
    bobChat,
  ]);
  assert(
    result.ok && result.rowCount === 0,
    "conversations: an update aimed at another account's row changes nothing",
    result.ok ? `updated ${result.rowCount} rows` : result.message,
  );

  result = await asUser(alice, `delete from conversations where id = $1`, [bobChat]);
  assert(
    result.ok && result.rowCount === 0,
    "conversations: a delete aimed at another account's row deletes nothing",
    result.ok ? `deleted ${result.rowCount} rows` : result.message,
  );

  result = await asUser(
    alice,
    `insert into conversations (user_id, title) values ($1, 'planted')`,
    [bob],
  );
  assert(
    !result.ok && result.code === '42501',
    'conversations: cannot insert a row owned by another account',
    result.ok ? 'the insert succeeded' : `${result.code}: ${result.message}`,
  );

  /* ---- an unauthenticated request sees nothing at all ------------ */

  console.log('\nan unauthenticated request (the anon key) sees nothing');

  for (const table of ['profiles', 'conversations', 'messages', 'monitored_locations']) {
    const anon = await asAnon(`select * from ${table}`);
    assert(
      (anon.ok && anon.rows.length === 0) || (!anon.ok && anon.code === '42501'),
      `${table}: anon reads nothing`,
      anon.ok ? `saw ${anon.rows.length} rows` : `${anon.code}: ${anon.message}`,
    );
  }

  console.log('\nthe alert tables are closed to the browser entirely');

  for (const table of ['subscribers', 'dispatch_claims', 'seen_warnings', 'dispatch_log']) {
    const anon = await asAnon(`select * from ${table}`);
    assert(
      (anon.ok && anon.rows.length === 0) || (!anon.ok && anon.code === '42501'),
      `${table}: anon reads nothing`,
      anon.ok ? `saw ${anon.rows.length} rows` : `${anon.code}: ${anon.message}`,
    );

    const user = await asUser(alice, `select * from ${table}`);
    assert(
      (user.ok && user.rows.length === 0) || (!user.ok && user.code === '42501'),
      `${table}: a signed-in user reads nothing`,
      user.ok ? `saw ${user.rows.length} rows` : `${user.code}: ${user.message}`,
    );
  }

  /* ---- the limits are in the schema, not in the app -------------- */

  console.log('\nthree monitored locations, enforced by the schema');

  await client.query(
    `insert into monitored_locations
       (user_id, slot, place_name, district, district_key, latitude, longitude)
     values ($1, 2, 'Nashik', 'Nashik', 'nashik', 19.99, 73.79),
            ($1, 3, 'Jaipur', 'Jaipur', 'jaipur', 26.91, 75.78)`,
    [alice],
  );
  ok('three places saved');

  try {
    await client.query(
      `insert into monitored_locations
         (user_id, slot, place_name, district, district_key, latitude, longitude)
       values ($1, 4, 'Surat', 'Surat', 'surat', 21.17, 72.83)`,
      [alice],
    );
    bad('a fourth slot is refused', 'the insert succeeded');
  } catch (error) {
    assert(
      error.code === '23514',
      'a fourth slot is refused by the check constraint',
      `${error.code}: ${error.message}`,
    );
  }

  try {
    await client.query(
      `insert into monitored_locations
         (user_id, slot, place_name, district, district_key, latitude, longitude)
       values ($1, 1, 'Somewhere', 'Somewhere', 'somewhere', 20.0, 78.0)`,
      [alice],
    );
    bad('a taken slot is refused', 'the insert succeeded');
  } catch (error) {
    assert(
      error.code === '23505',
      'a taken slot is refused by the unique constraint',
      `${error.code}: ${error.message}`,
    );
  }

  // The route picks the lowest free slot, so a real fourth request finds
  // none and is told the account is full. This is the same statement.
  const { rows: freeSlot } = await client.query(
    `select s.slot from (select generate_series(1, 3)::smallint as slot) s
      where s.slot not in (select slot from monitored_locations where user_id = $1)`,
    [alice],
  );
  assert(
    freeSlot.length === 0,
    'with three saved, the route finds no free slot to insert into',
    `free slots: ${JSON.stringify(freeSlot)}`,
  );

  try {
    await client.query(`delete from monitored_locations where user_id = $1 and slot = 3`, [
      alice,
    ]);
    await client.query(
      `insert into monitored_locations
         (user_id, slot, place_name, district, district_key, latitude, longitude)
       values ($1, 3, 'Barabanki town', 'Barabanki', 'barabanki', 26.92, 81.19)`,
      [alice],
    );
    bad('the same district twice is refused', 'the insert succeeded');
  } catch (error) {
    assert(
      error.code === '23505',
      'the same district twice is refused by the unique constraint',
      `${error.code}: ${error.message}`,
    );
  }

  /* ---- deleting an account takes everything with it -------------- */

  console.log('\ndeleting an account cascades');

  // Bound twice on purpose: `subscribers.id` is text, `user_id` is uuid, and
  // one parameter cannot be deduced as both. The store has the same shape,
  // for the same reason — this check is how that was found.
  await client.query(
    `insert into subscribers (id, user_id, districts, lang, channels)
     values ($1, $2::uuid, array['Barabanki'], 'hi', '[]'::jsonb)`,
    [alice, alice],
  );

  await client.query(`delete from auth.users where id = $1`, [alice]);

  for (const [table, column] of [
    ['profiles', 'id'],
    ['conversations', 'user_id'],
    ['messages', 'user_id'],
    ['monitored_locations', 'user_id'],
    ['subscribers', 'user_id'],
  ]) {
    const { rows } = await client.query(
      `select count(*)::int as n from ${table} where ${column} = $1`,
      [alice],
    );
    assert(rows[0].n === 0, `${table}: nothing left behind`, `${rows[0].n} rows remain`);
  }

  const { rows: bobIntact } = await client.query(
    `select count(*)::int as n from conversations where user_id = $1`,
    [bob],
  );
  assert(
    bobIntact[0].n === 1,
    'the other account is untouched',
    `${bobIntact[0].n} conversations`,
  );
} finally {
  // Whatever happened, the throwaway accounts go. A failed assertion must not
  // leave test rows in a production database.
  for (const id of [alice, bob]) {
    await client
      .query(`delete from auth.users where id = $1`, [id])
      .catch(() => {});
    await client.query(`delete from profiles where id = $1`, [id]).catch(() => {});
  }
  await client.end();
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures > 0) {
  console.error(`\n${failures} FAILED — one account can reach another's data.`);
  process.exit(1);
}

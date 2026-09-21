/**
 * Applies migrations/*.sql and reports what exists afterwards.
 *
 *   node scripts/migrate.mjs
 *
 * Every statement in every migration is IF NOT EXISTS or guarded by a
 * catalogue lookup, so this is safe to run repeatedly and safe to race.
 *
 * `*.down.sql` files are skipped. A reversal is a deliberate act run by hand,
 * never something a forward migration picks up because it matched a glob.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

await client.connect();

const dir = join(process.cwd(), 'migrations');
const forward = readdirSync(dir)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

// NOTICEs carry the skip messages from the auth-schema guards in 002, and
// swallowing them would hide the one thing worth knowing on a non-Supabase
// database: that the RLS policies were not created.
client.on('notice', (n) => console.log(`  notice: ${n.message}`));

for (const file of forward) {
  const t0 = Date.now();
  await client.query(readFileSync(join(dir, file), 'utf8'));
  console.log(`applied ${file} (${Date.now() - t0}ms)`);
}

const { rows } = await client.query(
  `select table_name,
          (select count(*) from information_schema.columns c
            where c.table_name = t.table_name and c.table_schema = 'public') as cols
     from information_schema.tables t
    where table_schema = 'public' order by table_name`,
);

console.log('\ntables in public:');
for (const r of rows) console.log(`  ${r.table_name.padEnd(18)} ${r.cols} columns`);

const { rows: keys } = await client.query(
  /*
   * Joined on the constraint's SCHEMA as well as its name. Without that, a
   * constraint of the same name in another schema joins in too — Supabase
   * ships a `realtime.messages`, and `public.messages` was reported as having
   * a primary key of (id, id, inserted_at).
   */
  `select tc.table_name, string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as pk
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name
      and kcu.constraint_schema = tc.constraint_schema
    where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
    group by tc.table_name order by tc.table_name`,
);

console.log('\nprimary keys:');
for (const k of keys) console.log(`  ${k.table_name.padEnd(18)} (${k.pk})`);

/*
 * Row-level security, printed every run.
 *
 * Every table in `public` is reachable through Supabase's PostgREST endpoint
 * with the anon key that now ships in the browser. A table with RLS off is
 * therefore public, and the only way to notice is to look — so this looks,
 * every time, rather than leaving it to be discovered.
 */
const { rows: rls } = await client.query(
  `select c.relname as table_name,
          c.relrowsecurity as rls,
          coalesce(
            (select string_agg(p.polname, ', ' order by p.polname)
               from pg_policy p where p.polrelid = c.oid),
            '—'
          ) as policies
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`,
);

console.log('\nrow-level security:');
for (const r of rls) {
  const state = r.rls ? 'ON ' : 'OFF';
  console.log(`  ${r.table_name.padEnd(20)} ${state}  ${r.policies}`);
}

const open = rls.filter((r) => !r.rls);
if (open.length > 0) {
  console.log(
    `\n  ⚠ RLS is OFF on: ${open.map((r) => r.table_name).join(', ')}\n` +
      '    Those tables are readable through the public API with the anon key.',
  );
}

await client.end();

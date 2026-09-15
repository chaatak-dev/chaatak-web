/**
 * Applies migrations/*.sql and reports what exists afterwards.
 *
 *   node scripts/migrate.mjs
 *
 * Every statement in the migration is IF NOT EXISTS, so this is safe to run
 * repeatedly and safe to race.
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
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
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
  `select tc.table_name, string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as pk
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name
    where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
    group by tc.table_name order by tc.table_name`,
);

console.log('\nprimary keys:');
for (const k of keys) console.log(`  ${k.table_name.padEnd(18)} (${k.pk})`);

await client.end();

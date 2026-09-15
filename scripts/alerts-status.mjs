/**
 * What the alert tables actually contain. Diagnostic only.
 *
 *   node scripts/alerts-status.mjs
 */

import { readFileSync } from 'node:fs';
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

const subs = await client.query(
  `select id, districts, lang, jsonb_array_length(channels) as channels from subscribers`,
);
console.log('subscribers:');
for (const s of subs.rows) {
  console.log(`  ${s.id}  districts=${s.districts}  lang=${s.lang}  channels=${s.channels}`);
}

const claims = await client.query(
  `select dispatch_key, state, attempt from dispatch_claims order by claimed_at`,
);
console.log('\ndispatch_claims (the idempotency table):');
for (const c of claims.rows) {
  console.log(`  ${c.dispatch_key.padEnd(46)} ${c.state.padEnd(7)} attempt=${c.attempt}`);
}

const log = await client.query(
  `select warning_id, kind, severity, channel, result, attempt, latency_ms
     from dispatch_log order by at`,
);
console.log('\ndispatch_log:');
for (const d of log.rows) {
  console.log(
    `  ${d.warning_id}  ${d.kind.padEnd(8)} ${String(d.severity).padEnd(8)} ` +
      `${d.channel.padEnd(8)} ${d.result.padEnd(7)} attempt=${d.attempt} ${d.latency_ms}ms`,
  );
}

const seen = await client.query(`select district, warning_id, severity, valid_to from seen_warnings`);
console.log('\nseen_warnings:', seen.rows.length === 0 ? '(empty — nothing in force)' : '');
for (const s of seen.rows) {
  console.log(`  ${s.district}  ${s.warning_id}  ${s.severity}  until ${s.valid_to.toISOString()}`);
}

await client.end();

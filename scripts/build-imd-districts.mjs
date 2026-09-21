/**
 * Regenerate lib/weather/imd-districts.json from IMD.
 *
 *   npm run build:imd-districts
 *
 * IMD keys district warnings on a numeric Obj_id, and Chaatak carries a
 * district NAME. Something has to join the two, and that something must come
 * from IMD rather than from us: inventing the number that decides whose
 * warning a person is shown is the worst available mistake in this codebase.
 *
 * There is no district list endpoint. `districtwarning` called WITHOUT an id
 * returns every district it knows — 718 of them, each with its Obj_id and its
 * name — so that is the list, discovered by asking rather than assumed.
 *
 * The data file is committed. Districts are not renamed often, and a runtime
 * dependency on this call would put IMD's availability in front of a lookup
 * that has no reason to need the network.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const ORIGIN = 'https://api.imd.gov.in';
const OUT = new URL('../lib/weather/imd-districts.json', import.meta.url);

function loadEnv() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
      }
    }
  } catch {
    /* the variables may already be in the environment */
  }
}

async function main() {
  loadEnv();
  for (const key of ['IMD_EMAIL', 'IMD_PASSWORD', 'IMD_API_KEY']) {
    if (!process.env[key]) {
      process.stderr.write(`${key} is required\n`);
      process.exit(1);
    }
  }

  const auth = await fetch(`${ORIGIN}/api/oauth/token.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.IMD_EMAIL,
      password: process.env.IMD_PASSWORD,
    }),
  });
  if (!auth.ok) {
    process.stderr.write(`sign-in failed: HTTP ${auth.status}\n`);
    process.exit(1);
  }
  const { access_token: token } = await auth.json();
  if (!token) {
    process.stderr.write('sign-in returned no access_token\n');
    process.exit(1);
  }

  const res = await fetch(`${ORIGIN}/api/v1/districtwarning`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-key': process.env.IMD_API_KEY,
      accept: 'application/json',
    },
  });
  if (!res.ok) {
    process.stderr.write(`district list failed: HTTP ${res.status}\n`);
    process.exit(1);
  }

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 500) {
    // 718 today. Far fewer means something changed upstream, and silently
    // shrinking the district list would silently stop warning people.
    process.stderr.write(`refusing: expected the full district list, got ${rows?.length}\n`);
    process.exit(1);
  }

  const seen = new Set();
  const districts = [];
  for (const row of rows) {
    const id = String(row.Obj_id ?? '').trim();
    const name = String(row.District ?? '').trim();
    if (!/^\d+$/.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    districts.push({ id, name });
  }

  districts.sort((a, b) => Number(a.id) - Number(b.id));

  writeFileSync(
    OUT,
    JSON.stringify({
      source: 'IMD (api.imd.gov.in/api/v1/districtwarning)',
      generated: new Date().toISOString().slice(0, 10),
      districts,
    }),
    'utf8',
  );
  process.stderr.write(`wrote ${districts.length} IMD districts\n`);
}

main().catch((error) => {
  process.stderr.write(`failed: ${error.stack ?? error}\n`);
  process.exit(1);
});

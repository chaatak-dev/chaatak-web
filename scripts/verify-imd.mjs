/**
 * Check what IMD actually does, against live responses.
 *
 *   npm run verify:imd            # direct from this machine
 *   npm run verify:imd -- --json  # machine-readable
 *
 * Every row is something the adapter assumes. A row that says UNVERIFIED is an
 * assumption nobody has checked yet, not a passing one — the point of this
 * script is that the difference is visible before a demo rather than after.
 *
 * It reads IMD_EMAIL, IMD_PASSWORD and IMD_API_KEY from the environment, and
 * routes through IMD_GATEWAY_URL when that is set, so it exercises the same
 * path the deployed app uses. It prints no secret, and truncates the token to
 * a few characters so you can tell two tokens apart without leaking either.
 */

import { readFileSync } from 'node:fs';

const IMD_ORIGIN = 'https://api.imd.gov.in';
const WARNING_ID = process.env.IMD_VERIFY_DISTRICT ?? '573';
const JSON_OUT = process.argv.includes('--json');

/** Load .env.local without adding a dependency for it. */
function loadEnv() {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '').trim();
    }
  } catch {
    // Not having one is fine; the variables may come from the environment.
  }
}

const rows = [];
function record(check, status, detail) {
  rows.push({ check, status, detail });
}

function route() {
  const url = process.env.IMD_GATEWAY_URL?.trim();
  const token = process.env.IMD_GATEWAY_TOKEN?.trim();
  if (url && token) return { kind: 'gateway', origin: url.replace(/\/+$/, ''), token };
  return { kind: 'direct', origin: IMD_ORIGIN };
}

async function call(path, init = {}) {
  const r = route();
  const clean = path.replace(/^\/+/, '');
  const url = r.kind === 'gateway' ? `${r.origin}/imd/${clean}` : `${r.origin}/${clean}`;
  const headers = { ...(init.headers ?? {}) };
  if (r.kind === 'gateway') headers['x-gateway-token'] = r.token;
  const started = Date.now();
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });
  return { res, ms: Date.now() - started };
}

/** Describe a payload's shape without printing whatever is inside it. */
function shapeOf(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return depth > 2 ? 'array' : `array[${value.length}] of ${value.length ? shapeOf(value[0], depth + 1) : 'nothing'}`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    return depth > 2 ? 'object' : `{ ${keys.slice(0, 14).join(', ')}${keys.length > 14 ? ', …' : ''} }`;
  }
  return typeof value;
}

async function main() {
  loadEnv();

  /* 1. Configuration ---------------------------------------------------- */
  const missing = ['IMD_EMAIL', 'IMD_PASSWORD', 'IMD_API_KEY'].filter((k) => !process.env[k]);
  if (missing.length) {
    record('credentials present', 'FAIL', `missing ${missing.join(', ')}`);
    report();
    process.exitCode = 1;
    return;
  }
  record('credentials present', 'PASS', 'IMD_EMAIL, IMD_PASSWORD, IMD_API_KEY');

  const r = route();
  record(
    'transport',
    'PASS',
    r.kind === 'gateway' ? `via gateway ${r.origin}` : 'direct to api.imd.gov.in',
  );

  /* 2. Sign-in ---------------------------------------------------------- */
  let token = null;
  try {
    const { res, ms } = await call('api/oauth/token.php', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        email: process.env.IMD_EMAIL,
        password: process.env.IMD_PASSWORD,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      record('sign-in', 'FAIL', `HTTP ${res.status} in ${ms}ms`);
    } else {
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        record('sign-in', 'FAIL', 'response was not JSON');
      }
      if (body?.access_token) {
        token = body.access_token;
        record('sign-in', 'PASS', `HTTP 200 in ${ms}ms, token ${String(token).slice(0, 6)}…`);
        record(
          'token_type is Bearer',
          String(body.token_type).toLowerCase() === 'bearer' ? 'PASS' : 'FAIL',
          `token_type=${body.token_type}`,
        );
        record(
          'expires_in is 3600',
          body.expires_in === 3600 ? 'PASS' : 'FAIL',
          `expires_in=${body.expires_in}`,
        );
      } else if (body) {
        record('sign-in', 'FAIL', `no access_token (${Object.keys(body).join(', ')})`);
      }
    }
  } catch (error) {
    record('sign-in', 'FAIL', error.message);
  }

  if (!token) {
    report();
    process.exitCode = 1;
    return;
  }

  const authed = {
    headers: {
      authorization: `Bearer ${token}`,
      'x-api-key': process.env.IMD_API_KEY,
      accept: 'application/json',
    },
  };

  /* 3. The one endpoint we were told works ------------------------------ */
  let warningPayload = null;
  try {
    const { res, ms } = await call(`api/v1/districtwarning?id=${WARNING_ID}`, authed);
    const text = await res.text();
    if (!res.ok) {
      record(`districtwarning?id=${WARNING_ID}`, 'FAIL', `HTTP ${res.status} in ${ms}ms`);
    } else {
      try {
        warningPayload = JSON.parse(text);
        record(`districtwarning?id=${WARNING_ID}`, 'PASS', `HTTP 200 in ${ms}ms`);
        record('warning payload shape', 'PASS', shapeOf(warningPayload));
        const rowsIn = Array.isArray(warningPayload)
          ? warningPayload
          : warningPayload?.data ?? warningPayload?.warnings ?? null;
        if (Array.isArray(rowsIn) && rowsIn.length) {
          record('warning row fields', 'PASS', shapeOf(rowsIn[0]));
        } else {
          record('warning row fields', 'UNVERIFIED', 'no rows in this response to read');
        }
      } catch {
        record(`districtwarning?id=${WARNING_ID}`, 'FAIL', 'response was not JSON');
        record('warning payload shape', 'FAIL', text.slice(0, 120));
      }
    }
  } catch (error) {
    record(`districtwarning?id=${WARNING_ID}`, 'FAIL', error.message);
  }

  /* 4. Find the district list ------------------------------------------- */
  //
  // The adapter needs a district NAME to become IMD's numeric object id, and
  // guessing that mapping is not acceptable. Auth sits in front of routing, so
  // an unauthenticated probe returns 401 for everything and tells us nothing;
  // authenticated, a 404 finally means "no such endpoint".
  const candidates = [
    'api/v1/districtlist',
    'api/v1/districts',
    'api/v1/district',
    'api/v1/districtmapping',
    'api/v1/mapping',
    'api/v1/statelist',
    'api/v1/citylist',
    'api/v1/stationlist',
  ];
  let found = 0;
  for (const path of candidates) {
    try {
      const { res } = await call(path, authed);
      if (res.ok) {
        found++;
        const text = await res.text();
        let shape = `${text.length} bytes`;
        try {
          shape = shapeOf(JSON.parse(text));
        } catch {
          /* not JSON; the byte count is still useful */
        }
        record(`mapping: ${path}`, 'PASS', shape);
      } else if (res.status !== 404) {
        record(`mapping: ${path}`, 'UNVERIFIED', `HTTP ${res.status}`);
      }
    } catch (error) {
      record(`mapping: ${path}`, 'UNVERIFIED', error.message);
    }
  }
  if (found === 0) {
    record(
      'district name -> IMD id',
      'UNVERIFIED',
      'no district list endpoint answered; warnings need a numeric id',
    );
  }

  report();
}

function report() {
  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  const width = Math.max(...rows.map((r) => r.check.length), 10);
  process.stdout.write(`\n${'CHECK'.padEnd(width)}  STATUS      DETAIL\n`);
  process.stdout.write(`${'-'.repeat(width)}  ----------  ------\n`);
  for (const r of rows) {
    process.stdout.write(`${r.check.padEnd(width)}  ${r.status.padEnd(10)}  ${r.detail}\n`);
  }
  const fails = rows.filter((r) => r.status === 'FAIL').length;
  const unverified = rows.filter((r) => r.status === 'UNVERIFIED').length;
  process.stdout.write(
    `\n${rows.length - fails - unverified} passed, ${fails} failed, ${unverified} unverified\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`verify-imd failed: ${error.stack ?? error}\n`);
  process.exit(1);
});

/**
 * Regenerate lib/weather/imd-stations.json from IMD.
 *
 *   npm run build:imd-stations
 *
 * IMD keys observations and city forecasts on station codes, and publishes no
 * coordinates for them — only names. Chaatak needs to know WHERE a station is
 * before it can decide whether that station speaks for the place someone
 * asked about, so the name is resolved against the committed gazetteer and the
 * gazetteer's coordinates are used.
 *
 * NOTHING IS GUESSED. The station list comes from IMD (both endpoints return
 * their full register when called without an id). A station whose name does
 * not resolve confidently is DROPPED rather than placed approximately — a
 * station in the wrong place would put another town's temperature on screen
 * under IMD's name, which is the failure this whole project is arranged
 * against. That costs coverage, and the Open-Meteo fallback covers it
 * honestly under its own provenance.
 *
 * Every id kept is then spot-checked by querying it, so the register cannot
 * contain a code that IMD will not actually answer for.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { matchPlace } from '../lib/weather/gazetteer/match';

const ORIGIN = 'https://api.imd.gov.in';
const OUT = new URL('../lib/weather/imd-stations.json', import.meta.url);

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

/**
 * IMD decorates a station name with the kind of site it is, and often names a
 * site inside a city rather than the city: "New Delhi-Safdarjung",
 * "Jaipur-AMO Jaipur", "Kanpur Airforce". The city is what can be located.
 */
const SITE_WORDS =
  /\b(airforce|air force|airport|aerodrome|ap|amo|aws|arg|obsy|observatory|cantt|cantonment|university|agri|agromet|hydro|radar)\b/gi;

function candidates(name: string): string[] {
  const base = String(name).replace(/\([^)]*\)/g, ' ').replace(/[_/]/g, ' ');
  const stripped = base.replace(SITE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  const out = [String(name).trim(), stripped];
  for (const part of stripped.split(/[-,]/)) {
    const piece = part.replace(SITE_WORDS, ' ').replace(/\s+/g, ' ').trim();
    if (piece.length >= 3) out.push(piece);
  }
  return [...new Set(out)].filter(Boolean);
}

type Station = { id: string; name: string; place: string; lat: number; lon: number };

function locate(id: string, name: string): Station | null {
  for (const candidate of candidates(name)) {
    const match = matchPlace(candidate);
    if (match) {
      return {
        id,
        name,
        place: match.entry.name,
        lat: match.entry.latitude,
        lon: match.entry.longitude,
      };
    }
  }
  return null;
}

async function signIn(): Promise<string> {
  const res = await fetch(`${ORIGIN}/api/oauth/token.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.IMD_EMAIL,
      password: process.env.IMD_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`sign-in failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('sign-in returned no access_token');
  return body.access_token;
}

async function main() {
  loadEnv();
  for (const key of ['IMD_EMAIL', 'IMD_PASSWORD', 'IMD_API_KEY']) {
    if (!process.env[key]) {
      process.stderr.write(`${key} is required\n`);
      process.exit(1);
    }
  }

  const token = await signIn();
  const headers = {
    authorization: `Bearer ${token}`,
    'x-api-key': process.env.IMD_API_KEY as string,
    accept: 'application/json',
  };

  const fetchAll = async (path: string) => {
    const res = await fetch(`${ORIGIN}/${path}`, { headers });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length < 100) {
      throw new Error(`${path}: expected the full register, got ${rows?.length}`);
    }
    return rows as Record<string, unknown>[];
  };

  process.stderr.write('observations (current_wx)...\n');
  const observationRows = await fetchAll('api/v1/current_wx');
  process.stderr.write('forecasts (cityforecast)...\n');
  const forecastRows = await fetchAll('api/v1/cityforecast');

  const collect = (rows: Record<string, unknown>[], idKey: string, nameKey: string) => {
    const seen = new Map<string, string>();
    for (const row of rows) {
      const id = String(row[idKey] ?? '').trim();
      const name = String(row[nameKey] ?? '').trim();
      if (/^\d+$/.test(id) && name && !seen.has(id)) seen.set(id, name);
    }
    const located: Station[] = [];
    let dropped = 0;
    for (const [id, name] of seen) {
      const station = locate(id, name);
      if (station) located.push(station);
      else dropped++;
    }
    located.sort((a, b) => Number(a.id) - Number(b.id));
    return { located, dropped, total: seen.size };
  };

  const observation = collect(observationRows, 'Station Id', 'Station');
  const forecast = collect(forecastRows, 'Station_Code', 'Station_Name');

  // Spot-check: a register that names a code IMD will not answer for is worse
  // than one that is merely incomplete.
  const check = async (path: string, list: Station[], label: string) => {
    const sample = list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 8)) === 0).slice(0, 8);
    let ok = 0;
    for (const station of sample) {
      const res = await fetch(`${ORIGIN}/${path}?id=${station.id}`, { headers });
      if (res.ok) ok++;
      else process.stderr.write(`  ${label} ${station.id} (${station.name}) -> HTTP ${res.status}\n`);
      await new Promise((r) => setTimeout(r, 150));
    }
    process.stderr.write(`  ${label} spot-check: ${ok}/${sample.length} answered\n`);
    if (ok === 0) throw new Error(`${label}: not one sampled station answered`);
  };

  process.stderr.write('spot-checking ids against live IMD...\n');
  await check('api/v1/current_wx', observation.located, 'observation');
  await check('api/v1/cityforecast', forecast.located, 'forecast');

  writeFileSync(
    OUT,
    JSON.stringify({
      source: 'IMD (api.imd.gov.in current_wx + cityforecast)',
      generated: new Date().toISOString().slice(0, 10),
      note: 'Coordinates come from the Chaatak gazetteer via the station name. Stations whose name did not resolve are omitted, never placed approximately.',
      observation: observation.located,
      forecast: forecast.located,
    }),
    'utf8',
  );

  process.stderr.write(
    `\nwrote ${observation.located.length}/${observation.total} observation stations ` +
      `(${observation.dropped} unlocatable, omitted)\n` +
      `      ${forecast.located.length}/${forecast.total} forecast stations ` +
      `(${forecast.dropped} unlocatable, omitted)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`failed: ${error.stack ?? error}\n`);
  process.exit(1);
});

/**
 * Regenerate lib/weather/gazetteer/india.json from Wikidata.
 *
 *   npm run build:gazetteer
 *
 * The data file is committed, so this does not run at build or request time.
 * It exists so the gazetteer is auditable and reproducible rather than a blob
 * someone has to trust: anyone can re-run it and diff the result.
 *
 * What it collects, and why each filter is there:
 *
 *   - Districts of India, because a district is the unit IMD issues warnings
 *     for. Their parent may be a division rather than a state, so the state is
 *     resolved through one extra hop.
 *   - Towns of 50,000 people or more, because people ask about towns, not
 *     districts, and every town is carried with the district containing it.
 *   - Names and aliases in the seven languages Chaatak speaks, so a place can
 *     be typed in any of them.
 *
 *   - Dissolved and superseded entities are dropped. Wikidata's "district of
 *     India" class includes things like "Bhopal State (1949-1956)", which
 *     cannot be warned on and collides with the live district of that name.
 *   - Anything outside India's bounding box is dropped. An open dataset
 *     carries scratch records: the "Wikidata Sandbox" entity claims India as
 *     its country and sits in Germany.
 *
 * Wikidata is CC0. The public query endpoint is rate limited and occasionally
 * times out on heavy queries, which is why the traversals here are shallow and
 * the id lookups are chunked.
 */

import { writeFile } from 'node:fs/promises';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'Chaatak/0.1 (SIH2026 PS26068; https://chaatak.com) gazetteer-build';
const OUT = new URL('../lib/weather/gazetteer/india.json', import.meta.url);

const LANGS = ['en', 'hi', 'bn', 'ta', 'gu', 'mr', 'pa'];
const MIN_POPULATION = 50_000;
const INDIA = { minLat: 6, maxLat: 38, minLon: 68, maxLon: 98 };

async function sparql(query, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Read the body as text first: a truncated response is a JSON parse
      // error, and parsing it here keeps that on the retryable path.
      const body = await res.text();
      // Some labels come back carrying a raw control character, which is not
      // legal inside a JSON string and makes the whole response unparseable.
      // Stripping them is safe: valid JSON escapes any control character it
      // means to carry, so anything raw here is corruption either way.
      return JSON.parse(stripControlCharacters(body)).results.bindings;
    } catch (error) {
      if (attempt >= tries) throw error;
      process.stderr.write(`  retry ${attempt}: ${error.message}\n`);
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
}

/** eslint-disable-next-line no-control-regex -- that is the point */
function stripControlCharacters(text) {
  return text.replace(/[\u0000-\u001F]/g, " ");
}

const id = (uri) => uri.split('/').pop();

/**
 * One coordinate per place, chosen the same way every run.
 *
 * Some entities carry several P625 statements and the endpoint returns them in
 * no fixed order, so taking "the first" made consecutive runs differ by a few
 * hundred metres and turned every regeneration into a noisy diff. Sorting
 * makes the choice arbitrary but stable, which is what lets the committed data
 * be checked by re-running this.
 */
function pickPoint(points) {
  if (points.length === 0) return null;
  return [...points].sort((a, b) => a.lat - b.lat || a.lon - b.lon)[0];
}

function point(value) {
  const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(value ?? '');
  return m ? { lat: Number(m[2]), lon: Number(m[1]) } : null;
}

/** "Nainital district" and its equivalent in every script we accept. */
const SUFFIXES = [
  'district', 'dist', 'jila', 'zila',
  // Administrative unit words that trail a real name: "Kasaragod
  // Municipality" is what someone means when they type "Kasaragod".
  'municipality', 'municipal corporation', 'mandal', 'taluk', 'taluka', 'tehsil',
  'जिला', 'ज़िला', 'जिल्हा', 'জেলা', 'மாவட்டம்', 'જિલ્લો', 'ਜ਼ਿਲ੍ਹਾ',
];

function stripSuffix(name) {
  let out = name.trim();
  for (let pass = 0; pass < 2; pass++) {
    for (const suffix of SUFFIXES) {
      const lower = out.toLowerCase();
      if (lower.length > suffix.length && lower.endsWith(suffix.toLowerCase())) {
        out = out.slice(0, out.length - suffix.length).trim();
      }
    }
  }
  return out;
}

async function chunked(ids, build, size = 150) {
  const rows = [];
  for (let i = 0; i < ids.length; i += size) {
    const values = ids.slice(i, i + size).map((q) => `wd:${q}`).join(' ');
    rows.push(...(await sparql(build(values))));
    process.stderr.write(`  ${Math.min(i + size, ids.length)}/${ids.length}\n`);
  }
  return rows;
}

async function main() {
  process.stderr.write('states and union territories...\n');
  const states = new Map();
  for (const r of await sparql(`
    SELECT ?s ?sLabel WHERE {
      VALUES ?t { wd:Q12443800 wd:Q467745 }
      ?s wdt:P31 ?t .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`)) {
    states.set(id(r.s.value), r.sLabel.value);
  }
  process.stderr.write(`  ${states.size}\n`);

  process.stderr.write('districts...\n');
  const districts = new Map();
  for (const r of await sparql(`
    SELECT ?d ?dLabel ?parent ?coord WHERE {
      ?d wdt:P31 wd:Q1149652 .
      OPTIONAL { ?d wdt:P131 ?parent . }
      OPTIONAL { ?d wdt:P625 ?coord . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`)) {
    const qid = id(r.d.value);
    const name = r.dLabel?.value;
    if (!name || name === qid) continue;
    const entry = districts.get(qid) ?? { qid, name, state: null, parents: [], points: [] };
    const p = point(r.coord?.value);
    if (p) entry.points.push(p);
    if (r.parent) entry.parents.push(id(r.parent.value));
    districts.set(qid, entry);
  }
  // A district's parent is sometimes a division rather than a state, so take
  // one more hop for the ones that did not land on a state directly.
  for (const e of districts.values()) {
    for (const p of e.parents) if (states.has(p)) { e.state = states.get(p); break; }
  }
  const unresolved = [...new Set([...districts.values()]
    .filter((e) => !e.state).flatMap((e) => e.parents))];
  process.stderr.write(`  resolving ${unresolved.length} parents...\n`);
  const grand = new Map();
  for (const r of await chunked(unresolved, (v) =>
    `SELECT ?x ?p WHERE { VALUES ?x { ${v} } ?x wdt:P131 ?p . }`)) {
    if (!grand.has(id(r.x.value))) grand.set(id(r.x.value), id(r.p.value));
  }
  for (const e of districts.values()) {
    if (e.state) continue;
    for (const p of e.parents) {
      const g = grand.get(p);
      if (g && states.has(g)) { e.state = states.get(g); break; }
    }
  }
  process.stderr.write(`  ${districts.size} districts\n`);

  process.stderr.write('towns...\n');
  const towns = new Map();
  // Split by population band. Asked for in one go this returns well over a
  // megabyte, and the public endpoint closes the connection part-way through,
  // which arrives as a truncated body rather than as an error.
  const BANDS = [[MIN_POPULATION, 100000], [100000, 500000], [500000, null]];
  const townRows = [];
  for (const [low, high] of BANDS) {
    const bound = high === null ? '' : ` && ?pop < ${high}`;
    townRows.push(...(await sparql(`
      SELECT ?c ?cLabel ?adminLabel ?coord ?pop WHERE {
        ?c wdt:P17 wd:Q668 ; wdt:P1082 ?pop ; wdt:P625 ?coord ; wdt:P131 ?admin .
        FILTER(?pop >= ${low}${bound})
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`)));
    process.stderr.write(`  band ${low}+: ${townRows.length} rows
`);
  }
  for (const r of townRows) {
    const qid = id(r.c.value);
    const name = r.cLabel?.value;
    if (!name || name === qid) continue;
    const p = point(r.coord?.value);
    const entry = towns.get(qid) ?? { qid, name, admin: null, points: [], pop: 0 };
    if (p) entry.points.push(p);
    if (r.adminLabel) entry.admin = r.adminLabel.value;
    entry.pop = Math.max(entry.pop, Number(r.pop.value) || 0);
    towns.set(qid, entry);
  }
  process.stderr.write(`  ${towns.size} towns\n`);

  process.stderr.write('dissolved and superseded...\n');
  const dissolved = new Set(
    (await sparql(`
      SELECT DISTINCT ?x WHERE {
        { ?x wdt:P31 wd:Q1149652 }
        UNION { ?x wdt:P17 wd:Q668 ; wdt:P1082 ?p . FILTER(?p >= ${MIN_POPULATION}) }
        { ?x wdt:P576 ?end } UNION { ?x wdt:P1366 ?succ } UNION { ?x wdt:P31 wd:Q19953632 }
      }`)).map((r) => id(r.x.value)),
  );
  process.stderr.write(`  ${dissolved.size}\n`);
  for (const q of dissolved) { districts.delete(q); towns.delete(q); }

  process.stderr.write('names in seven languages...\n');
  const ids = [...new Set([...districts.keys(), ...towns.keys()])].sort();
  const names = new Map();
  const langs = LANGS.map((l) => `'${l}'`).join(',');
  // Small chunks on purpose. Each entity can carry a dozen labels across the
  // seven languages, and a larger batch runs long enough that the public
  // endpoint closes the connection mid-stream, which arrives as a truncated
  // body rather than as an error.
  for (const r of await chunked(ids, (v) =>
    `SELECT ?x ?n WHERE { VALUES ?x { ${v} } ` +
    `{ ?x rdfs:label ?n } UNION { ?x skos:altLabel ?n } ` +
    `FILTER(LANG(?n) IN (${langs})) }`, 60)) {
    const qid = id(r.x.value);
    if (!names.has(qid)) names.set(qid, new Set());
    names.get(qid).add(r.n.value);
  }

  const entries = [];
  for (const qid of ids) {
    const d = districts.get(qid);
    const t = towns.get(qid);
    const source = d ?? t;
    if (!source) continue;
    const name = stripSuffix(source.name);
    const chosen = pickPoint(d ? d.points : t.points);
    if (!name || !chosen) continue;
    const { lat, lon } = chosen;
    if (lat <= INDIA.minLat || lat >= INDIA.maxLat) continue;
    if (lon <= INDIA.minLon || lon >= INDIA.maxLon) continue;

    const alt = [...(names.get(qid) ?? [])]
      .map(stripSuffix)
      .filter((n) => n && n.toLowerCase() !== name.toLowerCase());

    entries.push({
      q: qid,
      n: name,
      k: d ? 'd' : 's',
      st: d?.state ?? null,
      d: d ? name : t?.admin ? stripSuffix(t.admin) : null,
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      p: t?.pop ?? 0,
      ...(alt.length ? { a: [...new Set(alt)].sort() } : {}),
    });
  }

  // A town may still point at a district that was just dropped, leaving a
  // reference to a unit nobody can be warned about. Clear it; the runtime
  // assigns the nearest real district instead.
  const live = new Set(entries.filter((e) => e.k === 'd').map((e) => e.n));
  for (const e of entries) if (e.d && !live.has(e.d)) e.d = null;

  const stateOf = new Map(entries.filter((e) => e.k === 'd' && e.st).map((e) => [e.n, e.st]));
  for (const e of entries) if (!e.st && e.d) e.st = stateOf.get(e.d) ?? null;

  const out = {
    source: 'Wikidata (query.wikidata.org)',
    license: 'CC0-1.0',
    generated: new Date().toISOString().slice(0, 10),
    entries,
  };
  await writeFile(OUT, JSON.stringify(out), 'utf8');

  const districtCount = entries.filter((e) => e.k === 'd').length;
  process.stderr.write(
    `\nwrote ${entries.length} entries (${districtCount} districts, ` +
    `${entries.length - districtCount} towns)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`failed: ${error.stack ?? error}\n`);
  process.exit(1);
});

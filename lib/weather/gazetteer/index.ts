/**
 * An authoritative gazetteer of Indian districts and towns.
 *
 * WHY THIS EXISTS, rather than another geocoder call.
 *
 * A general geocoder indexes tens of millions of features worldwide, so the
 * nearest string match to an Indian place name is frequently not an Indian
 * place at all. Measured against the live resolver before this landed:
 * "Kolkatta" returned a restaurant in Bengaluru, "Jaypur" a village in West
 * Bengal 1,100km from Jaipur, and "Barabanki" a hamlet in Odisha rather than
 * the Uttar Pradesh district of 3.3 million. Each answer arrived with a
 * confident provenance line naming a source and an issue time.
 *
 * Chaatak does not need tens of millions of features. IMD issues warnings per
 * DISTRICT, and there are about 800 of them. Searching a closed, authoritative
 * set of the places this system can actually act on is both more correct and
 * far cheaper than searching the world and hoping the top hit is in India.
 *
 * The set is districts plus towns of 50,000 people or more. It contains no
 * points of interest, so no query can ever resolve to a restaurant.
 *
 * PROVENANCE. india.json is generated from Wikidata (CC0) by
 * `npm run build:gazetteer`, never written by hand. The generator is committed
 * beside it so the data can be regenerated and audited. Each entry keeps its
 * Wikidata id, which is the join key for IMD's own district list when that
 * lands in Phase 5 — at which point IMD becomes the authority for the district
 * set and this becomes the town supplement.
 */

import data from './india.json';
import { normalise, scriptOf, type ScriptTag } from './normalise';
import { isDevanagariName, romanise } from './romanise';

/** One place Chaatak can resolve to. */
export type GazetteerEntry = {
  /** Wikidata id. Provenance, and the future join key for IMD's district list. */
  id: string;
  name: string;
  /** A district is a unit IMD issues warnings for; a settlement sits inside one. */
  kind: 'district' | 'settlement';
  state: string | null;
  district: string | null;
  latitude: number;
  longitude: number;
  /** 0 when unknown. Used only to break an exact tie, never to accept a match. */
  population: number;
};

type RawEntry = {
  q: string; n: string; k: string; st: string | null; d: string | null;
  lat: number; lon: number; p: number; a?: string[];
};

export type NameIndex = {
  entries: GazetteerEntry[];
  /** normalised name -> indices into `entries`. */
  byName: Map<string, number[]>;
  /** script -> [normalised name, entry index] for fuzzy scanning. */
  byScript: Map<ScriptTag, [string, number][]>;
};

function build(): NameIndex {
  const raw = data.entries as RawEntry[];
  const entries: GazetteerEntry[] = raw.map((e) => ({
    id: e.q,
    name: e.n,
    kind: e.k === 'd' ? 'district' : 'settlement',
    state: e.st ?? null,
    district: e.d ?? null,
    latitude: e.lat,
    longitude: e.lon,
    population: e.p ?? 0,
  }));

  // Every place needs a district, because a district is what IMD issues a
  // warning for. Where the source did not record one, the containing district
  // is the nearest district centroid — geometry, not guesswork, and it means
  // no resolved place can arrive without the unit it will be warned on.
  const districts = entries.filter((e) => e.kind === 'district');
  for (const entry of entries) {
    if (entry.district && entry.state) continue;
    let nearest: GazetteerEntry | null = null;
    let best = Infinity;
    for (const d of districts) {
      const dy = d.latitude - entry.latitude;
      const dx = (d.longitude - entry.longitude) * Math.cos((entry.latitude * Math.PI) / 180);
      const sq = dy * dy + dx * dx;
      if (sq < best) { best = sq; nearest = d; }
    }
    if (nearest) {
      entry.district ??= nearest.district ?? nearest.name;
      entry.state ??= nearest.state;
    }
  }

  const byName = new Map<string, number[]>();
  const byScript = new Map<ScriptTag, [string, number][]>();

  const add = (form: string, i: number, tag: ScriptTag) => {
    const key = normalise(form);
    if (!key) return;
    const bucket = byName.get(key);
    if (bucket) {
      if (!bucket.includes(i)) bucket.push(i);
    } else {
      byName.set(key, [i]);
    }
    const list = byScript.get(tag);
    if (list) list.push([key, i]);
    else byScript.set(tag, [[key, i]]);
  };

  raw.forEach((e, i) => {
    // The canonical name and every recorded alias, in every script.
    for (const form of [e.n, ...(e.a ?? [])]) {
      add(form, i, scriptOf(form));

      // Hinglish: someone typing "Dilli" is not writing English or Devanagari,
      // and no edit distance from "Delhi" reaches it. Romanising the
      // Devanagari name gives that spelling a key of its own.
      if (isDevanagariName(form)) {
        const roman = romanise(form);
        if (roman) add(roman, i, 'latn');
      }
    }
  });

  return { entries, byName, byScript };
}

let cached: NameIndex | null = null;

/** Built once per process and reused; roughly 2,400 places and 9,000 names. */
export function index(): NameIndex {
  if (!cached) cached = build();
  return cached;
}

/**
 * Every name Wikidata records for the place whose canonical name this is —
 * current names, old names, regions and nicknames alike. Empty when the
 * gazetteer does not hold it.
 */
export function recordedNames(name: string): string[] {
  const key = normalise(name);
  if (!key) return [];
  const hit = (data.entries as RawEntry[]).find((e) => normalise(e.n) === key);
  return hit ? [...(hit.a ?? [])] : [];
}

export const GAZETTEER_SOURCE = data.source;
export const GAZETTEER_GENERATED = data.generated;

/**
 * The district containing a point, by nearest centroid.
 *
 * Used to attach a warnable unit to a place the gazetteer does not itself
 * hold — a village found by a geocoder still sits inside a district, and a
 * district is what IMD issues a warning for. India has over 700 district
 * centroids, so anywhere in the country is close to one.
 */
export function nearestDistrict(latitude: number, longitude: number): GazetteerEntry | null {
  let best: GazetteerEntry | null = null;
  let bestSq = Infinity;
  for (const entry of index().entries) {
    if (entry.kind !== 'district') continue;
    const dy = entry.latitude - latitude;
    // Longitude degrees shrink toward the poles; at Indian latitudes the
    // correction is large enough to change which district is nearest.
    const dx = (entry.longitude - longitude) * Math.cos((latitude * Math.PI) / 180);
    const sq = dy * dy + dx * dx;
    if (sq < bestSq) { bestSq = sq; best = entry; }
  }
  return best;
}

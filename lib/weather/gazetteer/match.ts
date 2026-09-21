/**
 * Matching a typed place name against the gazetteer.
 *
 * The whole job is deciding when NOT to answer. Returning the wrong district
 * in a warning system is the failure this code exists to prevent, and a fuzzy
 * matcher without a confidence gate is a machine for producing exactly that.
 * So every relaxation below is paired with something that can refuse.
 */

import { index, type GazetteerEntry } from './index';
import { normalise, scriptOf } from './normalise';

export type Match = {
  entry: GazetteerEntry;
  /** 'exact' when the name was written correctly, 'fuzzy' when repaired. */
  how: 'exact' | 'fuzzy';
  /** Edit distance actually used. 0 for exact. */
  distance: number;
};

/**
 * How far a typed name may stray from a real one, by length.
 *
 * Short names get no latitude at all: at four characters an edit distance of
 * one puts you inside several real districts at once — Bid, Bidar, Bijapur.
 * Longer names can absorb more, because the chance of two different real
 * districts sitting that close falls away as they get longer.
 */
function budget(length: number): number {
  if (length <= 4) return 0;
  if (length <= 6) return 1;
  if (length <= 12) return 2;
  return 3;
}

/**
 * Damerau-Levenshtein, bounded.
 *
 * Transpositions are counted as one edit, not two, because swapped letters are
 * how people actually mistype — "Chennia" for "Chennai". Anything beyond `max`
 * stops early and returns max + 1; the caller only cares whether it is within
 * budget.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push(new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = v;
      if (v < best) best = v;
    }
    // Whole row already past budget: no later row can come back under it.
    if (best > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/**
 * The consonant skeleton of a Latin name.
 *
 * Vowels are where transliteration disagrees with itself — Nainital, Nenital,
 * Nainithal — while the consonants are what stays put. Two names that agree on
 * consonants and differ on vowels are almost always the same place typed
 * twice; two that disagree on consonants are almost always different places.
 */
function skeleton(name: string): string {
  return name.replace(/[aeiou]/g, '');
}

/**
 * A second opinion on the loosest matches.
 *
 * At distance 2 edit distance alone starts pairing genuinely unrelated names:
 * "Shanghai" is two edits from Champhai in Mizoram, and returning a real
 * Indian district for a Chinese city is the wrong-place failure wearing a
 * plausible face. Requiring the consonants to agree as well separates the two
 * cases cleanly — Nenital and Nainital share the skeleton "nntl", Shanghai and
 * Champhai share nothing.
 *
 * Only applied to Latin, where vowels carry the transliteration noise. Indic
 * scripts write the vowel as part of the syllable and have no equivalent.
 */
function phoneticallyAgrees(query: string, candidate: string): boolean {
  if (!/^[a-z0-9]+$/.test(query) || !/^[a-z0-9]+$/.test(candidate)) return true;
  const a = skeleton(query);
  const b = skeleton(candidate);
  if (!a || !b) return true;
  return a === b;
}

/** A district outranks a town of the same name, then prominence decides. */
function prominence(entry: GazetteerEntry): number {
  return (entry.kind === 'district' ? 1_000_000_000 : 0) + entry.population;
}

/**
 * Resolve a typed name to one place, or to nothing.
 *
 * Nothing is a perfectly good answer here. The caller renders an explicit
 * "no data" state, which is honest, where a wrong district is not.
 */
export function matchPlace(query: string): Match | null {
  const key = normalise(query);
  if (!key) return null;

  const { entries, byName, byScript } = index();

  // 1. Exact. Someone spelled a real place correctly, in any of its scripts.
  const exact = byName.get(key);
  if (exact && exact.length > 0) {
    // Several places genuinely share a name (there are two Aurangabads, and a
    // district usually shares its name with the town at its centre).
    //
    // A place whose OWN name was typed wins over one that merely lists it as
    // an alias: "Mumbai" should come back as Mumbai, not as the Mumbai City
    // district that carries "Mumbai" among its other names. Past that, the
    // district outranks the town, and then the larger place wins.
    const best = exact
      .map((i) => entries[i])
      .sort((a, b) => {
        const an = normalise(a.name) === key ? 1 : 0;
        const bn = normalise(b.name) === key ? 1 : 0;
        if (an !== bn) return bn - an;
        return prominence(b) - prominence(a);
      })[0];
    return { entry: best, how: 'exact', distance: 0 };
  }

  // 2. Fuzzy, within one script only.
  //
  // Comparing Devanagari to Latin by edit distance is meaningless — they share
  // no characters, so every pair scores the same maximum and the "nearest"
  // match would be whichever happened to be shortest.
  const tag = scriptOf(query);
  const candidates = byScript.get(tag);
  if (!candidates) return null;

  const max = budget(key.length);
  if (max === 0) return null;

  let bestDistance = max + 1;
  let bestIndices: number[] = [];

  for (const [name, i] of candidates) {
    const d = editDistance(key, name, max);
    if (d > max) continue;
    // Loose matches must clear the phonetic check as well as the edit budget.
    if (d >= 2 && !phoneticallyAgrees(key, name)) continue;
    if (d < bestDistance) {
      bestDistance = d;
      bestIndices = [i];
    } else if (d === bestDistance && !bestIndices.includes(i)) {
      bestIndices.push(i);
    }
  }

  if (bestIndices.length === 0) return null;

  // 3. The confidence gate.
  //
  // One survivor is an answer. Several means the correction is genuinely
  // ambiguous — "Jaypur" sits one edit from both Jaipur in Rajasthan and
  // Jajpur in Odisha — and guessing between two real districts is precisely
  // the wrong-district failure this exists to prevent. Refuse instead.
  //
  // The single exception is a tie between a district and something inside it:
  // "Kolkata" the district and "Kolkata" the city are the same answer to the
  // person asking, not a choice.
  const hits = bestIndices.map((i) => entries[i]);
  if (hits.length > 1) {
    const ranked = [...hits].sort((a, b) => prominence(b) - prominence(a));
    const top = ranked[0];
    const sameplace = ranked.every(
      (h) => h === top || (h.district && top.district && h.district === top.district),
    );
    if (!sameplace) return null;
    return { entry: top, how: 'fuzzy', distance: bestDistance };
  }

  return { entry: hits[0], how: 'fuzzy', distance: bestDistance };
}

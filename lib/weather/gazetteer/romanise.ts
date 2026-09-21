/**
 * A Latin spelling for a Devanagari name, used only to add index keys.
 *
 * This is NOT the transliteration CLAUDE.md rejected. That one took a user's
 * Devanagari query and went looking for it in a foreign index, where जयपुर
 * could land on Jayapura in Indonesia — it changed which places were
 * reachable. This only ever adds another spelling of a place already in the
 * gazetteer, so the worst a bad romanisation can do is fail to match. It can
 * never introduce a place that is not already there, and the ambiguity gate
 * still applies on top.
 *
 * It exists because Hinglish is how a large part of the audience types: they
 * write "Dilli" and "Lakhnau", which are neither the English name nor the
 * Devanagari one, and no amount of edit distance from "Delhi" will reach
 * "Dilli" without crossing into distances that would match half the country.
 *
 * Approximate by design. It is a key generator feeding a fuzzy matcher, not a
 * scheme anyone reads.
 */

const CONSONANTS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n',
  च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm',
  य: 'y', र: 'r', ल: 'l', ळ: 'l', व: 'v',
  श: 'sh', ष: 'sh', स: 's', ह: 'h',
  क़: 'k', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'r', ढ़: 'rh', फ़: 'f',
};

/** Independent vowels. */
const VOWELS: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u',
  ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
};

/** Dependent vowel signs, which replace the inherent 'a'. */
const MATRAS: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
};

const VIRAMA = '्';
/** Anusvara and chandrabindu both come out as a nasal. */
const NASALS = new Set(['ं', 'ँ']);
/** Visarga and nukta carry no Latin letter of their own. */
const SILENT = new Set(['ः', '़']);

/**
 * True when the text is Devanagari and worth romanising.
 *
 * Marathi and Hindi share the script, so this covers both.
 */
export function isDevanagariName(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

export function romanise(text: string): string {
  let out = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    const consonant = CONSONANTS[ch];
    if (consonant) {
      out += consonant;
      const next = text[i + 1];
      if (next === VIRAMA) {
        // Halant: the inherent vowel is suppressed and the cluster continues.
        i++;
      } else if (next !== undefined && MATRAS[next]) {
        out += MATRAS[next];
        i++;
      } else if (next !== undefined && (NASALS.has(next) || SILENT.has(next))) {
        // Nasal or nukta directly on the consonant keeps the inherent vowel.
        out += 'a';
      } else {
        out += 'a';
      }
      continue;
    }

    if (VOWELS[ch]) { out += VOWELS[ch]; continue; }
    if (MATRAS[ch]) { out += MATRAS[ch]; continue; }
    if (NASALS.has(ch)) { out += 'n'; continue; }
    if (SILENT.has(ch) || ch === VIRAMA) continue;
    if (/\s/.test(ch)) { out += ' '; continue; }
    if (/[A-Za-z0-9]/.test(ch)) { out += ch.toLowerCase(); continue; }
  }

  // A trailing inherent 'a' is written in Devanagari and dropped in speech:
  // भोपाल is Bhopal, not Bhopala.
  out = out.replace(/([bcdfghjklmnpqrstvwxyz])a$/, '$1');
  return out.trim();
}

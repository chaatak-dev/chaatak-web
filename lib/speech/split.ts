/**
 * An answer, cut into pieces a voice can start on sooner.
 *
 * Synthesis takes time in proportion to the text (measured on Bhashini: a
 * short phrase in ~0.4 s, a sentence or two in ~1.9 s), and the whole answer
 * used to be synthesised before a word of it was heard. So it is spoken a
 * sentence at a time, the next one synthesised while the current one plays:
 * the wait before the voice is the wait for its first sentence.
 *
 * The first piece is kept short, because it alone is waited for; later
 * pieces are merged up to a comfortable length, because each is a request
 * and a seam in the prosody. Numbers are never split — "25.5" has no space
 * after its point — and nothing is dropped or reworded: the pieces, joined
 * with spaces, are the text.
 */

/** A first piece shorter than this is merged with the next — "हाँ।" is not worth a request. */
const MIN_FIRST = 24;
/** Later pieces are merged up to about this many characters. */
const TARGET_LATER = 220;

/** After a sentence end — danda, full stop, ? or ! — and the space that follows it. */
const SENTENCE_END = /(?<=[।॥.!?])\s+|\n+/u;

export function splitForSpeech(text: string): string[] {
  const sentences = text
    .split(SENTENCE_END)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return sentences;

  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    const limit = pieces.length === 0 ? MIN_FIRST : TARGET_LATER;
    const merged = `${current} ${sentence}`;
    // The first piece grows only until it is worth a request; later ones
    // until they would pass the target.
    if (pieces.length === 0 ? current.length < limit : merged.length <= limit) {
      current = merged;
    } else {
      pieces.push(current);
      current = sentence;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

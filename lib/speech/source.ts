/**
 * Which speech engine to use — the one config value.
 *
 * Bhashini is primary. Web Speech is the fallback for when Bhashini is
 * unreachable or the user is offline, and it needs no key, so it keeps working
 * on a bad connection where the server round trip would not.
 *
 * `unsupported` is only for a browser with neither.
 */

import { bhashiniSpeech } from './bhashini';
import { webSpeech } from './web-speech';
import type { SpeechSource, SpeechSupport } from './types';

export function speechSources(): SpeechSource[] {
  const order = (process.env.NEXT_PUBLIC_SPEECH_SOURCES ?? 'bhashini,web-speech')
    .split(',')
    .map((s) => s.trim());

  return order
    .map((name) =>
      name === 'bhashini' ? bhashiniSpeech : name === 'web-speech' ? webSpeech : null,
    )
    .filter((s): s is SpeechSource => s !== null);
}

/** The first source that can do the job, or null when none can. */
export function pickSource(
  capability: keyof SpeechSupport,
  sources = speechSources(),
): SpeechSource | null {
  for (const source of sources) {
    if (source.supports()[capability]) return source;
  }
  return null;
}

export { bhashiniSpeech, webSpeech };

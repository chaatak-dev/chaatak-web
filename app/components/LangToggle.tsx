'use client';

/**
 * Voice language: an explicit choice, never detection.
 *
 * Two buttons rather than a dropdown — a dropdown hides the current state and
 * costs two taps, and this has to work one-handed in a field.
 *
 * It governs speech only: which locale the recogniser listens in and which
 * voice reads the answer back. The screen stays bilingual either way, which is
 * why the label says "voice language" rather than promising to change the
 * page.
 */

import type { SpeechLang } from '@/lib/speech/types';

const OPTIONS: { value: SpeechLang; hi: string; en: string }[] = [
  { value: 'hi', hi: 'हिंदी', en: 'Hindi' },
  { value: 'en', hi: 'अंग्रेज़ी', en: 'English' },
];

export function LangToggle({
  value,
  onChange,
}: {
  value: SpeechLang;
  onChange: (lang: SpeechLang) => void;
}) {
  return (
    <div className="langtoggle">
      <p className="langtoggle__label" id="voice-language">
        <span lang="hi" className="langtoggle__label-hi">
          आवाज़ की भाषा
        </span>
        <span className="langtoggle__label-en">Voice language</span>
      </p>

      <div className="langtoggle__row" role="group" aria-labelledby="voice-language">
        {OPTIONS.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              className={`langtoggle__option${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
            >
              {/* Each option is written in its own language and tagged as such,
                  so "English" is not set in the Devanagari face. */}
              {option.value === 'hi' ? (
                <span lang="hi">{option.hi}</span>
              ) : (
                <span lang="en">{option.en}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

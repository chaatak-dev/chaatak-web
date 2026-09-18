'use client';

/**
 * Voice language: an explicit choice, never detection.
 *
 * Two languages fitted as a pair of buttons. Seven do not, and the honest
 * control for seven options on a phone is the platform's own picker — one tap,
 * the OS list, familiar, reachable one-handed, and it costs no header width.
 * Building a bespoke dropdown here would be worse at every one of those.
 *
 * Each option reads in its own script, because the label is the one thing in
 * this control that has to be legible to someone who reads nothing else on the
 * page. A Tamil speaker looks for தமிழ், not "Tamil".
 *
 * It governs speech only: which locale the recogniser listens in and which
 * voice reads the answer back. The label says so rather than promising to
 * translate the page.
 */

import { LANGUAGES, language, type LanguageCode } from '@/lib/i18n/languages';

function GlobeIcon() {
  return (
    <svg className="langpicker__icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M1.75 8h12.5M8 1.75c1.7 1.8 2.6 4 2.6 6.25S9.7 12.45 8 14.25C6.3 12.45 5.4 10.25 5.4 8S6.3 3.55 8 1.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg className="langpicker__chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m4 6.5 4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LangToggle({
  value,
  onChange,
}: {
  value: LanguageCode;
  onChange: (lang: LanguageCode) => void;
}) {
  const current = language(value);

  return (
    <div className="langpicker">
      <label className="langpicker__label" htmlFor="voice-language">
        <span lang="hi" className="langpicker__label-hi">
          आवाज़ की भाषा
        </span>
        <span className="langpicker__label-en">Voice language</span>
      </label>

      <div className="langpicker__control">
        <GlobeIcon />

        {/* The selected value is painted over the native select so it can be
            set in its own script; the select itself stays the real control,
            keyboard and screen reader included. */}
        <span className="langpicker__value" lang={current.code} aria-hidden="true">
          {current.native}
        </span>
        <ChevronIcon />

        <select
          id="voice-language"
          className="langpicker__select"
          value={value}
          aria-label={`Voice language, currently ${current.english}`}
          onChange={(event) => onChange(event.target.value as LanguageCode)}
        >
          {LANGUAGES.map((option) => (
            <option key={option.code} value={option.code} lang={option.code}>
              {option.native}
              {option.native === option.english ? '' : ` · ${option.english}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

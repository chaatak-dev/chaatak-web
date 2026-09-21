'use client';

/**
 * Three language settings, and nothing else.
 *
 * App language, assistant, voice. They are independent — this component has
 * no path that writes two of them — and each is a native `<select>` for the
 * same reason the voice picker always was: seven options on a phone want the
 * platform's own list. One tap, familiar, reachable with a thumb, and it
 * costs no width.
 *
 * Each option reads in its own script, because the label is the one thing in
 * this control that has to be legible to someone who reads nothing else on
 * the page. A Tamil speaker looks for தமிழ், not "Tamil".
 *
 * TWO HONEST NOTES, shown only when they apply. Chaatak's chrome exists in
 * Hindi and English; its warning taxonomy exists in Hindi and English; its
 * speech exists in all seven. Choosing Gujarati therefore gets Gujarati
 * answers and a Gujarati voice with an English interface, and the panel says
 * so rather than letting someone discover it. The alternative — hiding the
 * five from the list — would be tidier and would also be a smaller product
 * pretending to be a complete one.
 */

import { useId } from 'react';
import { useApp } from './AppState';
import {
  LANGUAGES,
  language,
  taxonomyIsBorrowed,
  type LanguageCode,
} from '@/lib/i18n/languages';
import type { LanguagePreference, LanguagePreferences } from '@/lib/i18n/preferences';
import type { StringKey } from '@/lib/i18n/strings';

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

function Picker({
  which,
  label,
  hint,
  autoKey,
}: {
  which: keyof LanguagePreferences;
  label: StringKey;
  hint: StringKey;
  autoKey: StringKey;
}) {
  const app = useApp();
  const id = useId();

  const value = app.preferences[which];
  const autoLabel = app.t(autoKey);

  // What the painted value shows: the chosen language in its own script, or
  // the word for automatic.
  const shown =
    value === 'auto' ? autoLabel : language(value).native;
  const shownLang = value === 'auto' ? app.languages.ui : value;

  return (
    <div className="langpicker">
      <label className="langpicker__label" htmlFor={id}>
        <span className="langpicker__label-text">{app.t(label)}</span>
      </label>

      <div className="langpicker__control">
        <GlobeIcon />

        {/* Painted over the native select so it can be set in its own script;
            the select itself stays the real control, keyboard and screen
            reader included. */}
        <span className="langpicker__value" lang={shownLang} aria-hidden="true">
          {shown}
        </span>
        <ChevronIcon />

        <select
          id={id}
          className="langpicker__select"
          value={value}
          aria-label={app.t(label)}
          onChange={(event) =>
            app.setLanguage(which, event.target.value as LanguagePreference)
          }
        >
          <option value="auto">{autoLabel}</option>
          {LANGUAGES.map((option) => (
            <option key={option.code} value={option.code} lang={option.code}>
              {option.native}
              {option.native === option.english ? '' : ` · ${option.english}`}
            </option>
          ))}
        </select>
      </div>

      <p className="langpicker__hint">{app.t(hint)}</p>
    </div>
  );
}

export function LanguagePanel() {
  const app = useApp();
  const { t, languages } = app;

  /*
   * The taxonomy note follows whichever language a WARNING will be read in.
   * That is the interface language for a dispatched alert and for every
   * template, so it is the interface choice that decides whether the gap
   * needs stating — not the voice, which was what it used to follow and
   * which is not what a warning is written in.
   */
  const taxonomyGap = taxonomyIsBorrowed(languages.uiChoice as LanguageCode);

  return (
    <div className="langsettings">
      <Picker
        which="ui"
        label="settings.ui"
        hint="settings.uiHint"
        autoKey="settings.auto"
      />
      <Picker
        which="assistant"
        label="settings.assistant"
        hint="settings.assistantHint"
        autoKey="settings.autoAssistant"
      />
      <Picker
        which="voice"
        label="settings.voice"
        hint="settings.voiceHint"
        autoKey="settings.autoAssistant"
      />

      {languages.uiIsBorrowed && (
        <p className="langnote" role="note">
          {t('settings.uiBorrowed', {
            language: language(languages.uiChoice).native,
            shown: language(languages.ui).native,
          })}
        </p>
      )}

      {taxonomyGap && (
        <p className="langnote" role="note">
          {t('settings.taxonomyBorrowed')}
        </p>
      )}
    </div>
  );
}

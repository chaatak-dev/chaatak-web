/**
 * The provenance line. Appears under every value in the product, and under
 * every absence state too — "we asked this endpoint at this time and it had
 * nothing" is provenance as much as a reading is.
 *
 * This is a design element, not fine print: a 2px rule in the active severity
 * colour, then the source, what kind of value it is, and the upstream
 * timestamp. The rule carries the severity down into the citation, so
 * severity stays legible even from the bottom of a block.
 *
 * ONE TEXT, READ BY EVERYONE. The line used to put its words in an
 * `aria-hidden` span and a sentence in an `aria-label` on the paragraph — and
 * `aria-label` is prohibited on a paragraph, so screen readers dropped it and
 * the citation under every number was silent. The visible words are now the
 * accessible words. The middle dots are decoration and hidden; a comma that
 * only a screen reader hears stands in for each, so the line is read as a
 * sentence rather than as "dot model dot".
 *
 * The mark is decorative, drawn inline and hidden from assistive technology.
 * Nothing here can put markup into text: every piece is a React child, never
 * a string built from HTML.
 */

'use client';

import type { TimeBasis, ValueNature } from '@/lib/weather/types';
import { formatStamp } from '@/lib/format';
import { useApp } from './AppState';
import type { StringKey } from '@/lib/i18n/strings';
import type { InterfaceLang } from '@/lib/i18n/languages';

const NATURE_KEY: Record<ValueNature, StringKey> = {
  model: 'provenance.model',
  observation: 'provenance.observation',
  bulletin: 'provenance.bulletin',
  archivedForecast: 'provenance.archivedForecast',
  reanalysis: 'provenance.reanalysis',
};

/** `unknown` is for absence states, where no severity has been established. */
export type ProvenanceSeverity =
  | 'none'
  | 'watch'
  | 'alert'
  | 'warning'
  | 'unknown'
  | 'stale';

/** `checked` is when we asked; the rest are what the source attested. */
export type StampBasis = TimeBasis | 'checked';

/**
 * The LINE tokens, not the band tokens.
 *
 * A band is a background with ink on it; a rule is drawn on the page. On a
 * dark ground those need opposite treatments, and using the band value here
 * shipped a red provenance rule at 1.72:1 — invisible. Light mode had the
 * mirror of the same bug: pale yellow at 1.53:1 on white.
 */
const RULE_COLOUR: Record<ProvenanceSeverity, string> = {
  none: 'var(--sev-none-line)',
  watch: 'var(--sev-watch-line)',
  alert: 'var(--sev-alert-line)',
  warning: 'var(--sev-warning-line)',
  unknown: 'var(--text-soft)',
  /** A cached value loses its severity colour: colour means "current". */
  stale: 'var(--text-soft)',
};

/**
 * Sources differ in what their timestamp means, so each says the true thing
 * rather than every value claiming to have been "issued".
 */
const BASIS_KEY: Record<StampBasis, StringKey> = {
  issued: 'provenance.issued',
  updated: 'provenance.updated',
  valid: 'provenance.valid',
  through: 'provenance.through',
  checked: 'provenance.checked',
};

/**
 * "Updated 20:30 IST", or — where the language puts it after — "20:30 IST
 * तक का आँकड़ा". Word order is the language's, not the template's.
 */
export function stampPhrase(word: string, stamp: string, basis: StampBasis, lang: InterfaceLang): string {
  return lang === 'hi' && basis === 'through' ? `${stamp} ${word}` : `${word} ${stamp}`;
}

function SourceMark() {
  return (
    <svg
      className="provenance__mark"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6" cy="6" r="1.6" fill="currentColor" />
      <path
        d="M2.9 3.3a4.4 4.4 0 0 0 0 5.4M9.1 3.3a4.4 4.4 0 0 1 0 5.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A middle dot for the eye, a comma for the ear. */
function Separator() {
  return (
    <>
      <span className="provenance__sep" aria-hidden="true">
        ·
      </span>
      <span className="sr-only">, </span>
    </>
  );
}

type Props = {
  source: string;
  /**
   * What kind of value this is — a model's output, an instrument's reading,
   * an issued bulletin, or a modelled past.
   *
   * This slot used to hold the API path. A visitor can act on "model"; nobody
   * can act on `/api/v1/current_wx`, and citing our own plumbing in a
   * provenance line is citing the wrong thing. The endpoint is still carried
   * in the data for traceability — it is simply not what is shown.
   */
  nature?: ValueNature;
  /** ISO 8601. From upstream for a value; our own clock only for `checked`. */
  timestamp: string;
  basis: StampBasis;
  /** The place's zone. Times read in local time, not the reader's. */
  timeZone: string;
  severity?: ProvenanceSeverity;
};

export function Provenance({
  source,
  nature,
  timestamp,
  basis,
  timeZone,
  severity = 'none',
}: Props) {
  const { t, languages } = useApp();
  const stamp = formatStamp(timestamp, timeZone);
  const when = stampPhrase(t(BASIS_KEY[basis]), stamp, basis, languages.ui);
  const natureWord = nature ? t(NATURE_KEY[nature]) : '';

  return (
    <p className="provenance" style={{ ['--sev' as string]: RULE_COLOUR[severity] }}>
      <SourceMark />
      <span className="provenance__text">
        <span className="sr-only">{t('provenance.sourceLabel')}: </span>
        <span className="provenance__source">{source}</span>
        {natureWord && (
          <>
            <Separator />
            <span className="provenance__nature">{natureWord}</span>
          </>
        )}
        <Separator />
        <span className="provenance__when">{when}</span>
      </span>
    </p>
  );
}

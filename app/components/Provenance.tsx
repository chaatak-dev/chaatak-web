/**
 * The provenance line. Appears under every value in the product, and under
 * every absence state too — "we asked this endpoint at this time and it had
 * nothing" is provenance as much as a reading is.
 *
 * This is a design element, not fine print: a 2px rule in the active severity
 * colour, then the source, the endpoint, and the upstream timestamp. The rule
 * carries the severity down into the citation, so severity stays legible even
 * from the bottom of a block.
 */

'use client';

import type { TimeBasis, ValueNature } from '@/lib/weather/types';
import { formatStamp } from '@/lib/format';
import { useApp } from './AppState';
import type { StringKey } from '@/lib/i18n/strings';

const NATURE_KEY: Record<ValueNature, StringKey> = {
  model: 'provenance.model',
  observation: 'provenance.observation',
  bulletin: 'provenance.bulletin',
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
  checked: 'provenance.checked',
};

function SourceMark() {
  return (
    <svg className="provenance__mark" viewBox="0 0 12 12" aria-hidden="true">
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

type Props = {
  source: string;
  /**
   * What kind of value this is — a model's output, an instrument's reading,
   * or an issued bulletin.
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
  const { t } = useApp();
  const stamp = formatStamp(timestamp, timeZone);
  const word = t(BASIS_KEY[basis]);

  const natureWord = nature ? t(NATURE_KEY[nature]) : '';

  const label = natureWord
    ? `${source}, ${natureWord}, ${word} ${stamp}`
    : `${source}, ${word} ${stamp}`;

  return (
    <p
      className="provenance"
      style={{ ['--sev' as string]: RULE_COLOUR[severity] }}
      aria-label={label}
    >
      <SourceMark />
      <span aria-hidden="true" className="provenance__text">
        <span className="provenance__source">{source}</span>
        {natureWord && (
          <>
            <span className="provenance__sep">·</span>
            <span className="provenance__endpoint">{natureWord}</span>
          </>
        )}
        <span className="provenance__sep">·</span>
        {word} {stamp}
      </span>
    </p>
  );
}

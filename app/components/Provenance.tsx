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

import type { TimeBasis } from '@/lib/weather/types';
import { formatStamp } from '@/lib/format';

/** `unknown` is for absence states, where no severity has been established. */
export type ProvenanceSeverity = 'none' | 'watch' | 'alert' | 'warning' | 'unknown';

/** `checked` is when we asked; the rest are what the source attested. */
export type StampBasis = TimeBasis | 'checked';

const RULE_COLOUR: Record<ProvenanceSeverity, string> = {
  none: 'var(--sev-none)',
  watch: 'var(--sev-watch)',
  alert: 'var(--sev-alert)',
  warning: 'var(--sev-warning)',
  unknown: 'var(--text-soft)',
};

/**
 * Sources differ in what their timestamp means, so each says the true thing
 * rather than every value claiming to have been "issued".
 */
const BASIS_WORD: Record<StampBasis, { hi: string; en: string }> = {
  issued: { hi: 'जारी', en: 'Issued' },
  updated: { hi: 'अपडेट', en: 'Updated' },
  valid: { hi: 'मान्य', en: 'Valid' },
  checked: { hi: 'जाँचा', en: 'Checked' },
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
  /** Empty when no endpoint was called, which is itself worth stating. */
  endpoint: string;
  /** ISO 8601. From upstream for a value; our own clock only for `checked`. */
  timestamp: string;
  basis: StampBasis;
  /** The place's zone. Times read in local time, not the reader's. */
  timeZone: string;
  severity?: ProvenanceSeverity;
};

export function Provenance({
  source,
  endpoint,
  timestamp,
  basis,
  timeZone,
  severity = 'none',
}: Props) {
  const stamp = formatStamp(timestamp, timeZone);
  const word = BASIS_WORD[basis];

  // A source with no such product was never called, so there is no endpoint to
  // cite. The segment is dropped rather than filled with a placeholder.
  const label = endpoint
    ? `Source ${source}, endpoint ${endpoint}, ${word.en.toLowerCase()} ${stamp}`
    : `Source ${source}, no endpoint called, ${word.en.toLowerCase()} ${stamp}`;

  return (
    <p
      className="provenance"
      style={{ ['--sev' as string]: RULE_COLOUR[severity] }}
      aria-label={label}
    >
      <SourceMark />
      <span aria-hidden="true" className="provenance__text">
        <span className="provenance__source">{source}</span>
        {endpoint && (
          <>
            <span className="provenance__sep">·</span>
            <span className="provenance__endpoint">{endpoint}</span>
          </>
        )}
        <span className="provenance__sep">·</span>
        <span lang="hi">{word.hi}</span> {stamp}
      </span>
    </p>
  );
}

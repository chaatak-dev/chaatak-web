/**
 * The warning slot: the first thing on the page below the header.
 *
 * Dispatches the three possible answers from `getWarnings`, which are three
 * genuinely different things and must never collapse into each other:
 *
 *   Warning[]   something is in force   → full-bleed severity band
 *   noWarning   asked, nothing in force → green settled statement
 *   noData      we do not know          → grey recessed field
 *
 * Phase 1 always lands on noData: Open-Meteo has no warning product. The other
 * two branches exist so Phase 4 changes one adapter and no consumer.
 */

import type { NoData, NoWarning, Severity, Warning } from '@/lib/weather/types';
import { hazardText } from '@/lib/weather/imd-codes';
import { NoDataField } from './NoDataField';
import { NoWarningField } from './NoWarningField';
import { Provenance } from './Provenance';

/**
 * IMD's colour scale, written out in words. Colour never works alone — a
 * colour-blind reader and a reader in bright sunlight both get the severity
 * from the text. Templates, never machine translation: MT can soften
 * "take action now" into something milder, which is a safety failure.
 */
const SEVERITY_WORDS: Record<Severity, { hi: string; en: string; action: { hi: string; en: string } }> = {
  none: {
    hi: 'हरी',
    en: 'Green',
    action: { hi: 'कोई चेतावनी नहीं', en: 'No warning' },
  },
  watch: {
    hi: 'पीली चेतावनी',
    en: 'Yellow warning',
    action: { hi: 'सतर्क रहें', en: 'Be aware' },
  },
  alert: {
    hi: 'नारंगी चेतावनी',
    en: 'Orange warning',
    action: { hi: 'तैयार रहें', en: 'Be prepared' },
  },
  warning: {
    hi: 'लाल चेतावनी',
    en: 'Red warning',
    action: { hi: 'तुरंत कार्रवाई करें', en: 'Take action now' },
  },
};

/** The loudest warning in the list sets the band. */
const RANK: Record<Severity, number> = { none: 0, watch: 1, alert: 2, warning: 3 };

function WarningBand({
  warnings,
  timeZone,
}: {
  warnings: Warning[];
  timeZone: string;
}) {
  const top = warnings.reduce((worst, w) =>
    RANK[w.severity] > RANK[worst.severity] ? w : worst,
  );
  const words = SEVERITY_WORDS[top.severity];

  return (
    <section
      className={`band band--${top.severity}`}
      role="alert"
      aria-label={`${words.en}. ${words.action.en}.`}
    >
      <p className="band__severity">
        <span lang="hi" className="band__severity-hi">
          {words.hi}
        </span>
        <span className="band__severity-en">{words.en}</span>
      </p>

      <p lang="hi" className="band__headline">
        {words.action.hi}
      </p>
      <p className="band__subtitle">{words.action.en}</p>

      {/*
        The hazard, in words, from IMD's own published code table. A code IMD
        has not published falls back to the number: better an unfamiliar
        number than a description nobody issued.

        Hindi above, English beneath, matching the severity band: the reader
        this is built for reads the first line.
      */}
      <p className="band__code">
        {warnings.length > 1 ? `${warnings.length} warnings · ` : ''}
        <span lang="hi">{hazardText(top.code, 'hi') || top.code}</span>
        <span className="band__code-en">{hazardText(top.code, 'en') || top.code}</span>
      </p>

      <Provenance
        source={top.provenance.source}
        nature={top.provenance.nature}
        timestamp={top.provenance.issuedAt}
        basis={top.provenance.timeBasis}
        timeZone={timeZone}
        severity={top.severity}
      />
    </section>
  );
}

export function WarningSlot({
  warnings,
  timeZone,
}: {
  warnings: Warning[] | NoWarning | NoData;
  timeZone: string;
}) {
  if (Array.isArray(warnings)) {
    // Adapters map an empty list to noWarning, so this is always non-empty.
    return <WarningBand warnings={warnings} timeZone={timeZone} />;
  }

  if (warnings.kind === 'noWarning') {
    return <NoWarningField state={warnings} timeZone={timeZone} />;
  }

  return <NoDataField state={warnings} timeZone={timeZone} />;
}

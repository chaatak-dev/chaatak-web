/**
 * `noData` — WE DO NOT KNOW.
 *
 * No product exists for this source, or the lookup failed, or the place does
 * not resolve. This is absence of information, and it reads as a recessed grey
 * field: a caps label, then a plain statement of what happened and what to do.
 *
 * Deliberately not an apology, not an error toast, and never an estimate. It
 * shares nothing with NoWarningField, which is good news rather than absence.
 */

import type { NoData, NoDataReason } from '@/lib/weather/types';
import { Provenance } from './Provenance';

const LABEL: Record<NoDataReason, { hi: string; en: string }> = {
  unknownPlace: { hi: 'जगह नहीं मिली', en: 'Place not found' },
  noProduct: { hi: 'चेतावनी उपलब्ध नहीं', en: 'No warning data' },
  lookupFailed: { hi: 'स्रोत से संपर्क नहीं', en: 'Source unreachable' },
  notInBulletin: { hi: 'बुलेटिन में नहीं', en: 'Not in bulletin' },
};

export function NoDataField({
  state,
  timeZone,
}: {
  state: NoData;
  timeZone: string;
}) {
  const label = LABEL[state.reason];

  return (
    <section className="absence absence--nodata">
      <p className="absence__label">
        <span lang="hi" className="absence__label-hi">
          {label.hi}
        </span>
        <span className="absence__label-en">{label.en}</span>
      </p>

      <p lang="hi" className="absence__statement">
        {state.statement.hi}
      </p>
      <p className="absence__statement-en">{state.statement.en}</p>

      <Provenance
        source={state.source}
        timestamp={state.checkedAt}
        basis="checked"
        timeZone={timeZone}
        severity="unknown"
      />
    </section>
  );
}

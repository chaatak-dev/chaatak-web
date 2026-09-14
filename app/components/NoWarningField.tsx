/**
 * `noWarning` — WE ASKED AND NOTHING IS IN EFFECT.
 *
 * A different thing from `noData` and deliberately a different component. The
 * source answered; the answer was "all clear". That is good news, so it reads
 * as a settled statement in the --sev-none treatment rather than as
 * uncertainty: a green rule, green-ink type, and a sentence that says plainly
 * that no warning has been issued.
 *
 * Phase 1 never renders this — Open-Meteo has no warning product, so its
 * adapter returns noData. Phase 4 renders it the moment IMD answers with an
 * empty warning list, and no consumer changes.
 */

import type { NoWarning } from '@/lib/weather/types';
import { Provenance } from './Provenance';

export function NoWarningField({
  state,
  timeZone,
}: {
  state: NoWarning;
  timeZone: string;
}) {
  // A bulletin time when the source stamped one; otherwise the time we asked.
  const stamped = state.issuedAt !== null;

  return (
    <section className="absence absence--nowarning">
      <p className="absence__label">
        <span lang="hi" className="absence__label-hi">
          कोई चेतावनी नहीं
        </span>
        <span className="absence__label-en">No warning</span>
      </p>

      <p lang="hi" className="absence__headline">
        कोई चेतावनी जारी नहीं है
      </p>
      <p className="absence__subtitle">No warning is in force for this area.</p>

      <Provenance
        source={state.source}
        endpoint={state.endpoint}
        timestamp={stamped ? (state.issuedAt as string) : state.checkedAt}
        basis={stamped ? state.timeBasis : 'checked'}
        timeZone={timeZone}
        severity="none"
      />
    </section>
  );
}

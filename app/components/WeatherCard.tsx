'use client';

/**
 * The weather card.
 *
 * WHAT IT IS ALLOWED TO BE. Chaatak's genre is an official notice, and that
 * rule is not suspended here — but a notice can still be beautiful, and a
 * number that changes with the sky it describes is easier to read at a glance
 * than a number on grey. So the card carries a quiet ground that responds to
 * the time of day and the condition, and nothing else changes: the type, the
 * severity treatment and the provenance line are exactly what they are
 * everywhere else.
 *
 * WHAT IT IS NOT ALLOWED TO BE. No icon set, no illustration, no animated
 * rain, no 3D. Those are the default for this category and they are wrong for
 * a product whose next screen may be a cyclone warning. Everything here is
 * two colour stops and a hairline.
 *
 * SEPARATE FROM THE THEME. Light, dark and system decide the page; this
 * decides one card's ground. A dark page at 3am and a dusk-coloured card are
 * different statements, and conflating them would make the card change when
 * somebody toggled the theme.
 */

import type { Location, Measurement } from '@/lib/weather/types';
import { conditionGroup, skyPhase } from '@/lib/weather/sky';
import type { Metric } from './WeatherRail';

export function WeatherCard({
  place,
  condition,
  conditionCode,
  temperature,
  metric,
  stale,
}: {
  place: Location;
  condition: string | null;
  conditionCode: number | null;
  temperature: Measurement | null;
  metric: Metric;
  stale: boolean;
}) {
  const phase = skyPhase(place.timezone);
  const group = conditionGroup(conditionCode);

  return (
    <section
      className={`wcard wcard--${phase} wcard--${group} wcard--${metric}${
        stale ? ' wcard--stale' : ''
      }`}
    >
      {/*
        A single hairline arc. Not an illustration of anything — it is the
        card's own horizon, and it is the only mark on the ground.
      */}
      <svg className="wcard__arc" viewBox="0 0 400 120" aria-hidden="true" preserveAspectRatio="none">
        <path
          d="M0 118 C 90 62, 150 46, 210 56 S 330 96, 400 60"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.35"
        />
      </svg>

      <div className="wcard__body">
        <p className="wcard__place">{place.name}</p>
        {place.admin1 && <p className="wcard__where">{place.admin1}</p>}

        {temperature ? (
          <p className="wcard__temp">
            <span className="wcard__temp-value">{temperature.value}</span>
            <span className="wcard__temp-unit">{temperature.unit}</span>
          </p>
        ) : (
          <p className="wcard__temp wcard__temp--absent">—</p>
        )}

        {condition && <p className="wcard__condition">{condition}</p>}
      </div>
    </section>
  );
}

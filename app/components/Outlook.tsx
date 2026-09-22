/**
 * The three-day outlook.
 *
 * Rows, not cards — they read better at 360px and the genre here is an
 * official notice, not a dashboard. A day the source did not forecast prints
 * an em dash; it is never filled in from the day beside it.
 *
 * One provenance line for the block, because every value in it came from one
 * endpoint in one call. Repeating the identical citation on each row would be
 * noise, not rigour.
 */

import type { Forecast, ForecastDay, NoData } from '@/lib/weather/types';
import { conditionFor } from '@/lib/weather/wmo';
import { formatDayLabel } from '@/lib/format';
import { NoDataField } from './NoDataField';
import { Provenance } from './Provenance';

/** An absent value states its absence rather than showing a plausible number. */
function Absent() {
  return (
    <span className="outlook__absent">
      <span aria-hidden="true">—</span>
      <span className="sr-only">not in bulletin</span>
    </span>
  );
}

function Row({
  day,
  units,
  timeZone,
}: {
  day: ForecastDay;
  units: Forecast['units'];
  timeZone: string;
}) {
  const label = formatDayLabel(day.date, timeZone);
  const template = conditionFor(day.conditionCode);

  return (
    <li className="outlook__row">
      <div className="outlook__day">
        <span lang="hi" className="outlook__day-hi">
          {label.hi}
        </span>
        <span className="outlook__day-en">
          {label.en} · {label.date}
        </span>
      </div>

      <div className="outlook__condition">
        {template ? (
          <>
            <span lang="hi" className="outlook__condition-hi">
              {template.hi}
            </span>
            <span className="outlook__condition-en">{template.en}</span>
          </>
        ) : (
          <span className="outlook__condition-en">
            {day.conditionCode === null ? 'Not given' : `Code ${day.conditionCode}`}
          </span>
        )}
      </div>

      <div className="outlook__temps">
        <span className="outlook__max">
          {day.maxTemp === null ? <Absent /> : `${day.maxTemp}${units.temperature}`}
        </span>
        <span className="outlook__min">
          {day.minTemp === null ? <Absent /> : `${day.minTemp}${units.temperature}`}
        </span>
      </div>
    </li>
  );
}

export function Outlook({
  forecast,
  timeZone,
}: {
  forecast: Forecast | NoData;
  timeZone: string;
}) {
  if (forecast.kind === 'noData') {
    return <NoDataField state={forecast} timeZone={timeZone} />;
  }

  return (
    <section className="outlook" aria-labelledby="outlook-heading">
      <p className="section-label" id="outlook-heading">
        <span lang="hi" className="section-label__hi">
          अगले तीन दिन
        </span>
        <span className="section-label__en">Next three days</span>
      </p>

      <ul className="outlook__list">
        {forecast.days.map((day) => (
          <Row key={day.date} day={day} units={forecast.units} timeZone={timeZone} />
        ))}
      </ul>

      <Provenance
        source={forecast.provenance.source}
        nature={forecast.provenance.nature}
        timestamp={forecast.provenance.issuedAt}
        basis={forecast.provenance.timeBasis}
        timeZone={timeZone}
        severity="none"
      />
    </section>
  );
}

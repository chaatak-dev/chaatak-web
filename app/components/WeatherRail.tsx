'use client';

/**
 * The weather rail: what it is doing where the conversation is about.
 *
 * It follows the conversation rather than having a location of its own, and
 * it shows the SAME snapshot the answer was written from — adopted, not
 * re-fetched. Two surfaces showing the same weather must not disagree by a
 * degree because they landed in different cache windows.
 *
 * WHAT IT NEVER DOES: guess where you are. With no conversation location and
 * no permission it shows an empty state and an offer, because "we do not
 * know" is the honest answer and a plausible wrong city is the failure this
 * whole product is arranged against.
 *
 * The alert control here is the SAME monitoring the sidebar uses — it adds a
 * monitored location through the existing store and the existing three-place
 * limit. There is no second subscription system.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from './AppState';
import { WeatherCard } from './WeatherCard';
import { MapEntry } from './MapEntry';
import { Provenance } from './Provenance';
import { freshness } from '@/lib/weather/freshness';
import { ageLabel } from '@/lib/offline/cache';
import { currentPosition, geoSupported } from '@/lib/geo';
import { fetchAirQuality, type AirQualityState } from '@/lib/weather/context';
import { conditionFor } from '@/lib/weather/wmo';
import { hazardText } from '@/lib/weather/imd-codes';
import { warningsInForce } from '@/lib/weather/snapshot';
import { severityAction, severityWords } from '@/lib/alerts/templates';
import { formatIstWindow } from '@/lib/format';
import type { WeatherSnapshot } from '@/lib/weather/api';
import type { Measurement } from '@/lib/weather/types';

/**
 * Whether this browser can offer a location at all.
 *
 * Read through a store with a defined server snapshot rather than called
 * during render: `navigator` does not exist on the server, so a direct call
 * rendered the button on the client and not in the HTML, and React reported a
 * hydration mismatch and threw the whole tree away.
 */
const noopSubscribe = () => () => {};

export type Metric = 'temperature' | 'precipitation' | 'wind' | 'aqi';

const METRICS: { key: Metric; label: 'rail.temperature' | 'rail.precipitation' | 'rail.wind' | 'rail.aqi' }[] = [
  { key: 'temperature', label: 'rail.temperature' },
  { key: 'precipitation', label: 'rail.precipitation' },
  { key: 'wind', label: 'rail.wind' },
  { key: 'aqi', label: 'rail.aqi' },
];

function reading(measurements: Measurement[], key: Measurement['key']): Measurement | null {
  return measurements.find((m) => m.key === key) ?? null;
}

export function WeatherRail() {
  const app = useApp();
  const { t, weather } = app;
  const [metric, setMetric] = useState<Metric>('temperature');
  const canLocate = useSyncExternalStore(noopSubscribe, geoSupported, () => false);
  const [air, setAir] = useState<AirQualityState>({ status: 'idle' });

  const place = weather.status === 'ready' ? weather.snapshot.place : null;

  /*
   * Air quality is only fetched when somebody selects it. It is a different
   * provider on a different cadence, and asking for it on every location
   * change would spend a request per conversation turn on a number nobody
   * looked at.
   */
  useEffect(() => {
    if (metric !== 'aqi' || !place) return;

    const controller = new AbortController();

    // Both writes happen inside the async call rather than in the effect
    // body, so selecting the metric does not cascade a render before the
    // request has even started.
    void (async () => {
      setAir({ status: 'loading' });
      const next = await fetchAirQuality(place, controller.signal);
      if (!controller.signal.aborted) setAir(next);
    })();

    return () => controller.abort();
  }, [metric, place]);

  if (weather.status === 'idle') {
    return (
      <div className="rail__empty">
        <p className="rail__empty-headline">{t('rail.emptyHeadline')}</p>
        <p className="rail__empty-body">{t('rail.emptyBody')}</p>
        {canLocate && (
          <button
            type="button"
            className="rail__locate"
            onClick={() => {
              void currentPosition().then((fix) => {
                // A refusal is not an error state. The empty state stands and
                // the person can type a place instead.
                if (fix.ok) app.showWeatherFor(fix.coords, 'device');
              });
            }}
          >
            {t('chat.useMyLocation')}
          </button>
        )}
      </div>
    );
  }

  if (weather.status === 'loading') {
    return <p className="rail__note">{t('rail.loading')}</p>;
  }

  if (weather.status === 'unresolved') {
    // The resolver's own words, in the reader's language. Not re-worded here.
    return <p className="rail__note">{weather.noData.statement[app.languages.ui]}</p>;
  }

  if (weather.status === 'failed') {
    return <p className="rail__note">{t('rail.failed')}</p>;
  }

  const { snapshot } = weather;
  const { current, outlook } = snapshot;

  const measurements = current.kind === 'reading' ? current.measurements : [];
  const temperature = reading(measurements, 'temperature');
  const feels = reading(measurements, 'apparentTemperature');
  const humidity = reading(measurements, 'humidity');
  const wind = reading(measurements, 'windSpeed');
  const rain = reading(measurements, 'precipitation');

  const today = outlook.kind === 'forecast' ? outlook.days[0] : null;
  const condition =
    current.kind === 'reading' ? conditionFor(current.conditionCode)?.[app.languages.ui] ?? null : null;

  /*
   * A value that is too old to be "now" says so, in place of the reassuring
   * silence that let a six-hour-old observation read as current.
   */
  const age = current.kind === 'reading' ? freshness(current.provenance) : null;
  const stale = age?.state === 'stale';

  return (
    <div className="rail__body">
      <h2 className="sr-only">{t('rail.title')}</h2>

      {/* Severity first: the band leads the rail as it leads every surface. */}
      <RailWarnings snapshot={snapshot} />

      <WeatherCard
        place={snapshot.place}
        condition={condition}
        conditionCode={current.kind === 'reading' ? current.conditionCode : null}
        temperature={temperature}
        metric={metric}
        stale={stale}
      />

      {stale && age && (
        <p className="rail__stale" role="status">
          {t('rail.staleNotice', { age: ageLabel(age.ageMinutes, app.languages.ui) })}
        </p>
      )}

      {current.kind !== 'reading' && (
        <p className="rail__note">{t('rail.unavailable')}</p>
      )}

      <dl className="rail__stats">
        {feels && (
          <div className="rail__stat">
            <dt>{t('rail.feelsLike')}</dt>
            <dd>
              {feels.value}
              <span className="rail__unit">{feels.unit}</span>
            </dd>
          </div>
        )}
        {today?.maxTemp !== null && today?.maxTemp !== undefined && (
          <div className="rail__stat">
            <dt>{t('rail.high')}</dt>
            <dd>
              {today.maxTemp}
              <span className="rail__unit">
                {outlook.kind === 'forecast' ? outlook.units.temperature : ''}
              </span>
            </dd>
          </div>
        )}
        {today?.minTemp !== null && today?.minTemp !== undefined && (
          <div className="rail__stat">
            <dt>{t('rail.low')}</dt>
            <dd>
              {today.minTemp}
              <span className="rail__unit">
                {outlook.kind === 'forecast' ? outlook.units.temperature : ''}
              </span>
            </dd>
          </div>
        )}
        {humidity && (
          <div className="rail__stat">
            <dt>{t('rail.humidity')}</dt>
            <dd>
              {humidity.value}
              <span className="rail__unit">{humidity.unit}</span>
            </dd>
          </div>
        )}
        {wind && (
          <div className="rail__stat">
            <dt>{t('rail.wind')}</dt>
            <dd>
              {wind.value}
              <span className="rail__unit">{wind.unit}</span>
            </dd>
          </div>
        )}
        {rain && (
          <div className="rail__stat">
            <dt>{t('rail.precipitation')}</dt>
            <dd>
              {rain.value}
              <span className="rail__unit">{rain.unit}</span>
            </dd>
          </div>
        )}
      </dl>

      <MonitorControl />

      {/*
        A set of pressed buttons, not tabs: there are no tab panels for them
        to own, and a tab list promises arrow keys it would not keep. Each is
        an ordinary button that says whether it is on.
      */}
      <div className="rail__metrics" role="group" aria-label={t('rail.metric')}>
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={metric === m.key}
            className={`rail__metric${metric === m.key ? ' rail__metric--on' : ''}`}
            onClick={() => setMetric(m.key)}
          >
            {t(m.label)}
          </button>
        ))}
      </div>

      {metric === 'aqi' && <AirQualityPanel state={air} />}

      <MapEntry />
    </div>
  );
}

/**
 * IMD's warnings for the place, as the first thing in the rail.
 *
 * In force: a band in the severity's colour AND its words — from the alert
 * catalogue, never from a model — then the hazards and their windows, loudest
 * first, and IMD's own provenance. Nothing in force: a plain settled line.
 * Could not ask: said so, because silence would read as an all-clear.
 */
function RailWarnings({ snapshot }: { snapshot: WeatherSnapshot }) {
  const { t, languages } = useApp();
  const warnings = snapshot.warnings;
  const ui = languages.ui;

  if (Array.isArray(warnings) && warnings.length > 0) {
    const sorted = warningsInForce(warnings);
    const top = sorted[0];
    const shown = sorted.slice(0, 3);
    return (
      <section className={`rwarn rwarn--${top.severity}`}>
        <p className="rwarn__severity">
          <span className="rwarn__words">{severityWords(top.severity, ui)}</span>
          <span className="rwarn__action">{severityAction(top.severity, ui)}</span>
        </p>
        <ul className="rwarn__list">
          {shown.map((w) => (
            <li key={w.id}>
              <span className="rwarn__hazard">{hazardText(w.code, ui) || w.code}</span>
              <span className="rwarn__when">{formatIstWindow(w.validFrom, w.validTo)}</span>
            </li>
          ))}
        </ul>
        {sorted.length > shown.length && (
          <p className="rwarn__more">{t('rail.moreWarnings', { count: sorted.length - shown.length })}</p>
        )}
        <Provenance
          source={top.provenance.source}
          nature={top.provenance.nature ?? 'bulletin'}
          timestamp={top.provenance.issuedAt}
          basis={top.provenance.timeBasis}
          timeZone={snapshot.place.timezone}
          severity={top.severity}
        />
      </section>
    );
  }

  if (!Array.isArray(warnings) && warnings.kind === 'noWarning') {
    return <p className="rwarn rwarn--clear">{t('rail.noWarning')}</p>;
  }

  return <p className="rail__note">{t('rail.warningsUnavailable')}</p>;
}

/**
 * Air quality, stated as exactly what it is.
 *
 * The index and the fact that it is modelled are not fine print. India's
 * official index is CPCB's, on different breakpoints, and a reader who knows
 * that scale would silently misread this number without the label.
 */
function AirQualityPanel({ state }: { state: AirQualityState }) {
  const { t } = useApp();

  if (state.status === 'loading') return <p className="rail__note">{t('rail.loading')}</p>;
  if (state.status !== 'ready') {
    return <p className="rail__note">{t('rail.aqiUnavailable')}</p>;
  }

  const { air } = state;

  return (
    <div className="rail__aqi">
      <p className={`rail__aqi-value rail__aqi-value--${air.band}`}>
        {air.value}
        <span className="rail__aqi-band">{air.band}</span>
      </p>
      <ul className="rail__aqi-parts">
        {air.components.map((c) => (
          <li key={c.key}>
            <span>{c.key.replace('_', '.').toUpperCase()}</span> {c.value}
            <span className="rail__unit">{c.unit}</span>
          </li>
        ))}
      </ul>
      <p className="rail__aqi-note">{t('rail.aqiModelled')}</p>
    </div>
  );
}

/**
 * Monitor this district's official IMD warnings.
 *
 * Goes through the SAME monitored-locations store the sidebar uses — the same
 * three-place limit, the same duplicate rule, the same subscriber row the
 * alert daemon reads. There is deliberately no second path: a rail that had
 * its own subscription logic would be a second source of truth for who gets
 * woken at 3am.
 */
function MonitorControl() {
  const app = useApp();
  const { t, weather } = app;
  const [busy, setBusy] = useState(false);

  if (weather.status !== 'ready') return null;
  const { place } = weather.snapshot;

  // Accounts switched off on this deployment: there is nothing to sign in
  // to, so nothing is offered — not a prompt pointing at a missing button.
  if (!app.configured) return null;

  if (!app.user) {
    return <p className="rail__monitor-note">{t('rail.monitorSignIn')}</p>;
  }

  const district = place.admin2 ?? place.name;
  const already = app.locations.locations.some(
    (l) => l.district.toLowerCase() === district.toLowerCase(),
  );

  if (already) {
    return (
      <p className="rail__monitored">{t('rail.monitored', { place: district })}</p>
    );
  }

  return (
    <>
      <button
        type="button"
        className="rail__monitor"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void app
            .addLocation({ latitude: place.latitude, longitude: place.longitude })
            .finally(() => setBusy(false));
        }}
      >
        {t('rail.monitor', { place: district })}
      </button>
      <p className="rail__monitor-note">{t('rail.monitorHint')}</p>
    </>
  );
}

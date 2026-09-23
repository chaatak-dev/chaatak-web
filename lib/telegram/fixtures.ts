/**
 * Test fixtures for the Telegram tests: one place, one snapshot, one answer.
 *
 * Deliberately odd numbers (31.27, 36.08) so a test can tell a value printed
 * verbatim from one that was rounded on the way.
 */

import type { Answer } from '../chat/answer';
import type { WeatherSnapshot } from '../weather/api';
import type { DistrictId, Location, NoData, Warning } from '../weather/types';

export const GHAZIABAD: Location = {
  name: 'Ghaziabad',
  admin1: 'Uttar Pradesh',
  admin2: 'Ghaziabad',
  country: 'India',
  countryCode: 'IN',
  latitude: 28.6692,
  longitude: 77.4538,
  timezone: 'Asia/Kolkata',
  resolvedBy: 'Chaatak gazetteer (test)',
  endpoint: 'gazetteer:exact',
};

export const MODINAGAR: Location = {
  ...GHAZIABAD,
  name: 'Modinagar',
  latitude: 28.8356,
  longitude: 77.6197,
};

export function minutesAgo(minutes: number, now = Date.now()): string {
  return new Date(now - minutes * 60_000).toISOString();
}

export function orangeWarning(overrides: Partial<Warning> = {}): Warning {
  return {
    kind: 'warning',
    id: 'IMD-GZB-1',
    code: '2',
    severity: 'alert',
    district: 'Ghaziabad' as DistrictId,
    validFrom: '2026-09-23T00:00:00+05:30',
    validTo: '2026-09-23T23:59:00+05:30',
    provenance: {
      source: 'IMD',
      endpoint: '/api/v1/districtwarning',
      issuedAt: minutesAgo(90),
      timeBasis: 'issued',
      nature: 'bulletin',
    },
    ...overrides,
  };
}

export function snapshot(
  overrides: Partial<WeatherSnapshot> = {},
  place: Location = GHAZIABAD,
): WeatherSnapshot {
  const at = minutesAgo(10);
  return {
    place,
    current: {
      kind: 'reading',
      conditionCode: 2,
      measurements: [
        { key: 'temperature', value: 31.27, unit: '°C' },
        { key: 'apparentTemperature', value: 36.08, unit: '°C' },
        { key: 'humidity', value: 71, unit: '%' },
        { key: 'windSpeed', value: 12.4, unit: 'km/h' },
      ],
      provenance: {
        source: 'Open-Meteo',
        endpoint: '/v1/forecast',
        issuedAt: at,
        timeBasis: 'updated',
        nature: 'model',
      },
    },
    outlook: {
      kind: 'forecast',
      units: { temperature: '°C', precipitation: 'mm' },
      days: [
        { date: '2026-09-23', conditionCode: 63, maxTemp: 33.1, minTemp: 26.4, precipitationSum: 12.3 },
        { date: '2026-09-24', conditionCode: 2, maxTemp: null, minTemp: 27, precipitationSum: 0 },
      ],
      provenance: {
        source: 'Open-Meteo',
        endpoint: '/v1/forecast',
        issuedAt: at,
        timeBasis: 'updated',
        nature: 'model',
      },
    },
    warnings: [orangeWarning()],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

export const NO_WARNING_PRODUCT: NoData = {
  kind: 'noData',
  reason: 'noProduct',
  source: 'Open-Meteo',
  endpoint: '/v1/forecast',
  checkedAt: minutesAgo(1),
  statement: {
    hi: 'इस स्रोत से चेतावनी उपलब्ध नहीं है।',
    en: 'This source issues no warnings.',
  },
};

/** An answer shaped exactly as `answerQuestion` returns one. */
export function answerFor(
  text: string,
  options: { snap?: WeatherSnapshot | null; needsLocation?: boolean; chrome?: 'hi' | 'en' } = {},
): Answer {
  const snap = options.snap === undefined ? snapshot() : options.snap;
  const chrome = options.chrome ?? 'en';
  return {
    chrome,
    title: {
      question: text,
      place: snap?.place.name ?? null,
      intent: 'current',
      timeWindow: { kind: 'now' },
      variable: 'all',
      lang: chrome,
    },
    reply: {
      text,
      lang: chrome,
      script: chrome === 'hi' ? 'Deva' : 'Latn',
      speakAs: chrome,
      standing: snap
        ? {
            place: snap.place.name,
            resolvedPlace: snap.place,
            intent: 'current',
            timeWindow: { kind: 'now' },
            variable: 'all',
            setAt: new Date().toISOString(),
          }
        : null,
      ...(options.needsLocation ? { needsLocation: true as const } : {}),
      ...(snap
        ? {
            snapshot: snap,
            grounding: {
              place: snap.place,
              provenance:
                snap.current.kind === 'reading'
                  ? snap.current.provenance
                  : { source: 'Open-Meteo', endpoint: 'x', issuedAt: snap.fetchedAt, timeBasis: 'updated' as const },
              severity: 'alert' as const,
              facts: {},
            },
          }
        : {}),
      meta: {
        parseLayer: 'pattern',
        act: 'weather',
        fromModel: false,
        gate: 'skipped',
        latencyMs: 1,
        langBasis: 'script',
        langConfidence: 'high',
      },
    },
  };
}

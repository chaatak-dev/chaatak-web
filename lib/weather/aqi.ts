/**
 * Air quality, behind an interface, and never over-claimed.
 *
 * THE THING THIS FILE IS CAREFUL ABOUT. India has an official air quality
 * index — the CPCB National AQI, computed from a real monitoring network on a
 * scale and breakpoints of its own. What this module currently returns is
 * NOT that. It is a European index computed from a global atmospheric model,
 * and the two disagree: the same air can be "moderate" on one scale and
 * "poor" on the other, because they are different scales with different
 * breakpoints answering to different regulators.
 *
 * So every value carries the index it was computed on and the fact that it
 * came from a model. Calling a CAMS-derived European AQI "the AQI" in an
 * Indian product would be the same category error as calling a model's
 * output an observation — fluent, plausible, and wrong in the direction that
 * matters, since air quality is a health number people act on.
 *
 * The station fields exist and are null. They are the seam CPCB data arrives
 * through: a real station has an id, a name and a distance, and a reading
 * that has those is a different kind of claim from one that does not.
 */

import { TTL, cached } from '../cache';
import type { Location, NoData, NoDataReason, Provenance } from './types';

/**
 * Which index a number is on.
 *
 * Not cosmetic. "62" means different things on each of these, and a reader
 * who knows the CPCB scale will misread a European number silently.
 */
export type AqiStandard =
  /** CPCB National AQI. India's official index. Not yet wired. */
  | 'cpcb'
  /** The European Environment Agency index, as CAMS publishes it. */
  | 'european'
  /** The US EPA index. */
  | 'us';

export type AqiBand =
  | 'good'
  | 'fair'
  | 'moderate'
  | 'poor'
  | 'veryPoor'
  | 'severe';

export type AirQuality = {
  kind: 'aqi';
  /** The index value, on `standard`'s scale. Meaningless without it. */
  value: number;
  standard: AqiStandard;
  band: AqiBand;
  /** The pollutants behind it, where the provider reports them. */
  components: { key: 'pm2_5' | 'pm10' | 'no2' | 'o3' | 'so2'; value: number; unit: string }[];
  /**
   * The station this came from, when it came from one.
   *
   * Null for modelled data, and that is the distinction the interface reads
   * to decide whether it may say "measured at".
   */
  station: { id: string; name: string; distanceKm: number } | null;
  provenance: Provenance;
};

export interface AirQualitySource {
  name: string;
  standard: AqiStandard;
  get(location: Location): Promise<AirQuality | NoData>;
}

/* ------------------------------------------------------------------ */
/* Bands                                                               */
/* ------------------------------------------------------------------ */

/**
 * The European index's own bands. Each standard brings its own — CPCB's
 * breakpoints are different numbers with different names, and mapping one
 * onto the other is exactly the silent mistranslation this file refuses.
 */
function europeanBand(value: number): AqiBand {
  if (value <= 20) return 'good';
  if (value <= 40) return 'fair';
  if (value <= 60) return 'moderate';
  if (value <= 80) return 'poor';
  if (value <= 100) return 'veryPoor';
  return 'severe';
}

/* ------------------------------------------------------------------ */
/* Open-Meteo / CAMS                                                   */
/* ------------------------------------------------------------------ */

const SOURCE = 'Open-Meteo (CAMS)';
const HOST = 'https://air-quality-api.open-meteo.com';
const PATH = '/v1/air-quality';
const TIMEOUT_MS = 8000;

function noData(reason: NoDataReason, statement: { hi: string; en: string }): NoData {
  return {
    kind: 'noData',
    reason,
    source: SOURCE,
    endpoint: PATH,
    checkedAt: new Date().toISOString(),
    statement,
  };
}

type AirQualityBody = {
  utc_offset_seconds?: number;
  current?: Record<string, unknown>;
  current_units?: Record<string, string>;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Open-Meteo returns local times with no offset; the offset comes separately. */
function toIsoWithOffset(local: string, offsetSeconds: number): string {
  const sign = offsetSeconds < 0 ? '-' : '+';
  const abs = Math.abs(offsetSeconds);
  const hh = String(Math.floor(abs / 3600)).padStart(2, '0');
  const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0');
  return `${local}:00${sign}${hh}:${mm}`;
}

export const openMeteoAir: AirQualitySource = {
  name: SOURCE,
  standard: 'european',

  async get(location: Location): Promise<AirQuality | NoData> {
    const url =
      `${HOST}${PATH}?latitude=${location.latitude}&longitude=${location.longitude}` +
      `&current=european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide` +
      `&timezone=${encodeURIComponent(location.timezone)}`;

    return cached<AirQuality | NoData>(
      `aqi:eu:${location.latitude.toFixed(2)},${location.longitude.toFixed(2)}`,
      TTL.current,
      async () => {
        let body: AirQualityBody;
        try {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          body = (await res.json()) as AirQualityBody;
        } catch {
          return noData('lookupFailed', {
            hi: 'हवा की गुणवत्ता अभी नहीं मिल सकी।',
            en: 'Air quality could not be fetched right now.',
          });
        }

        const current = body.current;
        const value = numberOrNull(current?.european_aqi);
        const time = current?.time;

        if (value === null || typeof time !== 'string') {
          return noData('notInBulletin', {
            hi: 'इस जगह के लिए हवा की गुणवत्ता उपलब्ध नहीं है।',
            en: 'No air quality figure is available for this place.',
          });
        }

        const units = body.current_units ?? {};
        const components: AirQuality['components'] = [];
        const add = (key: AirQuality['components'][number]['key'], field: string) => {
          const n = numberOrNull(current?.[field]);
          if (n !== null) components.push({ key, value: n, unit: units[field] ?? 'µg/m³' });
        };

        add('pm2_5', 'pm2_5');
        add('pm10', 'pm10');
        add('no2', 'nitrogen_dioxide');
        add('o3', 'ozone');
        add('so2', 'sulphur_dioxide');

        return {
          kind: 'aqi',
          value,
          standard: 'european',
          band: europeanBand(value),
          components,
          // Modelled. There is no station, and saying so is the difference
          // between this and a CPCB reading.
          station: null,
          provenance: {
            source: SOURCE,
            endpoint: PATH,
            issuedAt: toIsoWithOffset(time, body.utc_offset_seconds ?? 0),
            timeBasis: 'updated',
            nature: 'model',
            observedAt: null,
            fetchedAt: new Date().toISOString(),
          },
        } satisfies AirQuality;
      },
      (result) => !('reason' in result) || result.reason !== 'lookupFailed',
    );
  },
};

/**
 * The air quality source in use.
 *
 * One function, one config value, like every other provider choice in this
 * codebase — so the day a CPCB adapter exists, switching to it is a line here
 * and nothing above this file changes.
 */
export function airQualitySource(): AirQualitySource {
  return openMeteoAir;
}

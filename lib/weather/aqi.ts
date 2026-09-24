/**
 * Air quality, behind an interface, and never over-claimed.
 *
 * THE THING THIS FILE IS CAREFUL ABOUT. India has an official air quality
 * index — the CPCB National AQI, computed from a real monitoring network on a
 * scale and breakpoints of its own. The fallback this module can also return
 * is NOT that. It is a European index computed from a global atmospheric
 * model, and the two disagree: the same air can be "moderate" on one scale
 * and "poor" on the other, because they are different scales with different
 * breakpoints answering to different regulators.
 *
 * So every value carries the index it was computed on and the fact that it
 * came from a station or a model. Calling a CAMS-derived European AQI "the
 * AQI" in an Indian product would be the same category error as calling a
 * model's output an observation — fluent, plausible, and wrong in the
 * direction that matters, since air quality is a health number people act on.
 *
 * CPCB is primary (`lib/weather/cpcb.ts`). Where it has no station near enough
 * with a current reading, the modelled figure is returned instead, still
 * labelled European and modelled, and carrying why CPCB was not used. It is
 * never relabelled as CPCB.
 */

import { TTL, cached } from '../cache';
import { ConfigurationError } from '../errors';
import { europeanBand, type AqiBand } from './aqi-bands';
import { cpcbAir, resolveCpcb, CPCB_SOURCE, MAX_STATION_KM, type CpcbMiss } from './cpcb';
import type { Location, NoData, NoDataReason, Provenance } from './types';

export type { AqiBand } from './aqi-bands';

/**
 * Which index a number is on.
 *
 * Not cosmetic. "62" means different things on each of these, and a reader
 * who knows the CPCB scale will misread a European number silently.
 */
export type AqiStandard =
  /** CPCB National AQI. India's official index. */
  | 'cpcb'
  /** The European Environment Agency index, as CAMS publishes it. */
  | 'european'
  /** The US EPA index. */
  | 'us';

export type AirQuality = {
  kind: 'aqi';
  /** The index value, on `standard`'s scale. Meaningless without it. */
  value: number;
  standard: AqiStandard;
  band: AqiBand;
  /**
   * What the component numbers are.
   *
   * CPCB publishes each pollutant's sub-index, on the AQI's own scale and with
   * no unit; the model publishes concentrations. Showing "58" beside PM2.5
   * means something different in each, so the reading says which.
   */
  measure: 'concentration' | 'subIndex';
  /** The pollutants behind it, where the provider reports them. */
  components: { key: string; value: number; unit: string }[];
  /**
   * The station this came from, when it came from one.
   *
   * Null for modelled data, and that is the distinction the interface reads
   * to decide whether it may say "measured at".
   */
  station: { id: string; name: string; distanceKm: number } | null;
  /**
   * Set when this reading stands in for the primary source, and why.
   *
   * A modelled figure shown because CPCB had no station nearby is a different
   * statement from a modelled figure chosen on purpose, and the reader is told
   * which one they are looking at.
   */
  fallback?: { from: string; miss: CpcbMiss; withinKm: number };
  provenance: Provenance;
};

export interface AirQualitySource {
  name: string;
  standard: AqiStandard;
  /**
   * What answers where this source cannot, if anything. Declared so a caller
   * that reads the network directly — the map — follows the same rule.
   */
  fallback?: AirQualitySource;
  get(location: Location): Promise<AirQuality | NoData>;
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
        const add = (key: string, field: string) => {
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
          measure: 'concentration',
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

/* ------------------------------------------------------------------ */
/* CPCB first, the model where CPCB has nothing                        */
/* ------------------------------------------------------------------ */

/**
 * CPCB's station reading where one is near enough and current; otherwise the
 * modelled European figure, marked as the fallback with CPCB's reason.
 *
 * The fallback keeps every label it had — standard `european`, nature
 * `model`, no station. Only the `fallback` note is added, so no path through
 * here can present a modelled number as CPCB's.
 */
export const cpcbWithFallback: AirQualitySource = {
  name: `${CPCB_SOURCE}, else ${SOURCE}`,
  standard: 'cpcb',
  fallback: openMeteoAir,

  async get(location: Location): Promise<AirQuality | NoData> {
    const cpcb = await resolveCpcb(location);
    if (cpcb.kind === 'reading') return cpcb.air;

    const modelled = await openMeteoAir.get(location);
    if (modelled.kind === 'noData') return modelled;
    return {
      ...modelled,
      fallback: { from: CPCB_SOURCE, miss: cpcb.miss, withinKm: MAX_STATION_KM },
    };
  },
};

const SOURCES: Record<string, AirQualitySource> = {
  cpcb: cpcbWithFallback,
  // CPCB with no fallback at all, for a deployment that would rather show
  // nothing than a modelled index.
  'cpcb-only': cpcbAir,
  'open-meteo': openMeteoAir,
};

/**
 * The air quality source in use.
 *
 * One config value, like every other provider choice in this codebase:
 * `AIR_QUALITY_SOURCE`, defaulting to CPCB with the modelled fallback. CPCB
 * without its key configured simply misses everywhere, so the default is
 * safe before the key is set — every reading is the labelled model.
 *
 * An unknown name throws rather than falling back, so a typo fails at the
 * first request instead of quietly changing what the index means.
 */
export function airQualitySource(): AirQualitySource {
  const name = process.env.AIR_QUALITY_SOURCE?.trim() || 'cpcb';
  const source = SOURCES[name];
  if (!source) {
    throw new ConfigurationError(
      `Unknown AIR_QUALITY_SOURCE "${name}". Known: ${Object.keys(SOURCES).join(', ')}`,
    );
  }
  return source;
}

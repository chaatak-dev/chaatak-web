/**
 * Interface copy. These are our words for our own furniture — field labels and
 * headings. They are never weather values, so nothing here is bound by the
 * provenance rule.
 *
 * Anything describing actual conditions or severity lives in a template table
 * keyed on the source's own code. See `wmo.ts`.
 */

import type { MeasurementKey } from './types';

export type Bilingual = { hi: string; en: string };

export const MEASUREMENT_LABELS: Record<MeasurementKey, Bilingual> = {
  temperature: { hi: 'तापमान', en: 'Temperature' },
  apparentTemperature: { hi: 'महसूस होता है', en: 'Feels like' },
  humidity: { hi: 'आर्द्रता', en: 'Humidity' },
  precipitation: { hi: 'वर्षा', en: 'Precipitation' },
  windSpeed: { hi: 'हवा की गति', en: 'Wind speed' },
};

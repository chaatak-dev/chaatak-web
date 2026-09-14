/**
 * The shape crossing the network. Shared by the route and the page so the two
 * cannot drift apart.
 */

import type {
  Forecast,
  Location,
  NoData,
  NoWarning,
  Reading,
  Warning,
} from './types';

/** Current conditions plus a 3-day outlook. */
export const OUTLOOK_DAYS = 3;

export type WeatherResponse =
  | {
      kind: 'resolved';
      query: string;
      place: Location;
      current: Reading | NoData;
      outlook: Forecast | NoData;
      /** A `Warning[]` here is always non-empty; adapters map empty to noWarning. */
      warnings: Warning[] | NoWarning | NoData;
    }
  | {
      kind: 'unresolved';
      query: string;
      /** Why the place could not be turned into coordinates. */
      noData: NoData;
    };

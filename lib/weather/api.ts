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

/**
 * ONE canonical view of the weather at one resolved location.
 *
 * The whole point is that there is one. The conversation and the weather rail
 * show the same numbers because they are handed the same object, not because
 * two independent fetches happened to agree — which they would not, since
 * they would land in different cache windows and disagree by a degree at
 * exactly the moment somebody noticed.
 *
 * `fetchedAt` is when this was assembled. It is diagnostic and it is NOT any
 * value's time: each reading, forecast and warning carries its own
 * provenance, and `freshness()` reads those.
 */
export type WeatherSnapshot = {
  place: Location;
  current: Reading | NoData;
  outlook: Forecast | NoData;
  /** A `Warning[]` here is always non-empty; adapters map empty to noWarning. */
  warnings: Warning[] | NoWarning | NoData;
  fetchedAt: string;
};

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

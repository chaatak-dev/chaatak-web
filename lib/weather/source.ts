/**
 * Choosing a source.
 *
 * There are TWO selectors, deliberately, because the user path and the alert
 * daemon have different tolerances for invented data.
 *
 *   weatherSource()  — anything a visitor can see. Refuses synthetic sources.
 *   warningSource()  — the alert daemon only. May be synthetic.
 *
 * They were one selector until production ran with WEATHER_SOURCE=fixture,
 * which meant chaatak.com was prepared to show real visitors a warning that
 * had been invented to test a pipeline. Splitting them makes that
 * unrepresentable rather than merely discouraged: the fixture is not in the
 * user-facing registry at all, and the guard below keys on the source's own
 * `synthetic` flag, so renaming one cannot slip it through.
 *
 * Phase 5 adds the IMD adapter and sets WEATHER_SOURCE=imd. Nothing above the
 * adapter layer changes — that is the whole point of the interface.
 */

import { fixtureSource } from './fixture';
import { openMeteo } from './open-meteo';
import { routedPlaces } from './places';
import type { PlaceResolver, WeatherSource } from './types';

/** Sources a visitor may be shown. Synthetic sources are not eligible. */
const REAL_SOURCES: Record<string, WeatherSource> = {
  'open-meteo': openMeteo,
};

/** Everything the alert daemon may poll, including test fixtures. */
const WARNING_SOURCES: Record<string, WeatherSource> = {
  ...REAL_SOURCES,
  fixture: fixtureSource,
};

function known(registry: Record<string, WeatherSource>): string {
  return Object.keys(registry).join(', ');
}

/**
 * The source behind everything a visitor sees: the chat, the weather route,
 * every value rendered on screen.
 *
 * Throws rather than falling back. A misconfigured source must fail loudly at
 * the first request — falling back to a default would hide the mistake, and
 * the mistake this guards against is serving invented weather to someone who
 * believes it.
 */
export function weatherSource(): WeatherSource {
  const name = process.env.WEATHER_SOURCE ?? 'open-meteo';
  const source = REAL_SOURCES[name];

  if (!source) {
    // Named a synthetic source for the user path: say exactly what to do
    // instead, because the fix is a different variable and not an obvious one.
    if (WARNING_SOURCES[name]?.synthetic) {
      throw new Error(
        `WEATHER_SOURCE="${name}" is a synthetic source and must never serve visitors. ` +
          `Set WEATHER_SOURCE=open-meteo, and use WARNING_SOURCE=${name} if you ` +
          `want the alert daemon to poll the fixture.`,
      );
    }
    throw new Error(
      `Unknown WEATHER_SOURCE "${name}". Known: ${known(REAL_SOURCES)}`,
    );
  }

  return source;
}

/**
 * The source the alert daemon polls for warnings. Nothing user-facing calls
 * this.
 *
 * Defaults to whatever serves visitors, so the daemon does not silently
 * diverge from the app; a fixture has to be asked for by name.
 */
export function warningSource(): WeatherSource {
  const name =
    process.env.WARNING_SOURCE ?? process.env.WEATHER_SOURCE ?? 'open-meteo';
  const source = WARNING_SOURCES[name];

  if (!source) {
    throw new Error(
      `Unknown WARNING_SOURCE "${name}". Known: ${known(WARNING_SOURCES)}`,
    );
  }
  return source;
}

/**
 * Routed by script: Open-Meteo for Latin, Nominatim for Devanagari. Not
 * switched with the weather source — a geocode is not a weather value, and
 * IMD has no geocoder, so this survives the Phase 5 swap unchanged.
 */
export function placeResolver(): PlaceResolver {
  return routedPlaces;
}

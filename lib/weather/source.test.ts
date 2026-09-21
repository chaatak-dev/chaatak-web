import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fixtureSource } from './fixture';
import { warningSource, weatherSource } from './source';

/**
 * Synthetic data must never reach a visitor.
 *
 * This shipped: production ran with WEATHER_SOURCE=fixture, which meant
 * chaatak.com was prepared to show real people a warning invented to test a
 * pipeline. It was caught by reading the env list, not by anything in the
 * code — nothing objected, because one config value drove both the user path
 * and the alert daemon.
 *
 * The fix is structural rather than procedural: two selectors, and a guard
 * keyed on the source's own `synthetic` flag rather than on its name.
 */

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('the fixture declares itself synthetic', () => {
  // The guard keys on this flag, not on the name, so renaming the fixture
  // cannot slip it past.
  assert.equal(fixtureSource.synthetic, true);
});

test('a real source serves visitors', () => {
  withEnv({ WEATHER_SOURCE: 'open-meteo', WARNING_SOURCE: undefined }, () => {
    assert.equal(weatherSource().name, 'Open-Meteo');
    assert.notEqual(weatherSource().synthetic, true);
  });
});

test('the user path REFUSES a synthetic source', () => {
  // The whole point. This must throw rather than fall back, because a silent
  // fallback would hide exactly the misconfiguration that shipped.
  withEnv({ WEATHER_SOURCE: 'fixture' }, () => {
    assert.throws(() => weatherSource(), /synthetic source and must never serve visitors/);
  });
});

test('refusing says what to set instead', () => {
  // The fix is a different variable and not an obvious one, so the error
  // names it rather than leaving someone to guess.
  withEnv({ WEATHER_SOURCE: 'fixture' }, () => {
    assert.throws(() => weatherSource(), /WEATHER_SOURCE=open-meteo/);
    assert.throws(() => weatherSource(), /WARNING_SOURCE=fixture/);
  });
});

test('an unknown source throws rather than defaulting', () => {
  // This used to name "imd", back when IMD was the thing that did not exist
  // yet. It does now, so the example has to be something that genuinely is
  // not a source.
  withEnv({ WEATHER_SOURCE: 'meteorological-vibes' }, () => {
    assert.throws(() => weatherSource(), /Unknown WEATHER_SOURCE "meteorological-vibes"/);
  });
});

test('IMD is a real source and may serve visitors', () => {
  // The whole point of the adapter layer: one config value, nothing above it
  // changes, and IMD is not synthetic so the user-facing guard lets it past.
  withEnv({ WEATHER_SOURCE: 'imd' }, () => {
    assert.equal(weatherSource().name, 'IMD');
    assert.notEqual(weatherSource().synthetic, true);
  });
});

test('the daemon can poll IMD without the app being switched to it', () => {
  withEnv({ WEATHER_SOURCE: 'open-meteo', WARNING_SOURCE: 'imd' }, () => {
    assert.equal(warningSource().name, 'IMD');
    assert.equal(weatherSource().name, 'Open-Meteo');
  });
});

test('the daemon may poll a synthetic source', () => {
  withEnv({ WEATHER_SOURCE: 'open-meteo', WARNING_SOURCE: 'fixture' }, () => {
    assert.equal(warningSource().synthetic, true);
    // And the user path is unaffected by it.
    assert.notEqual(weatherSource().synthetic, true);
  });
});

test('the daemon follows the app unless told otherwise', () => {
  // A daemon that silently diverged from what the app serves would be its own
  // kind of surprise, so the fixture has to be asked for by name.
  withEnv({ WEATHER_SOURCE: 'open-meteo', WARNING_SOURCE: undefined }, () => {
    assert.equal(warningSource().name, weatherSource().name);
  });
});

test('WARNING_SOURCE=fixture does not leak into the user path', () => {
  // The configuration the demo actually runs on.
  withEnv({ WEATHER_SOURCE: 'open-meteo', WARNING_SOURCE: 'fixture' }, () => {
    const visitorFacing = weatherSource();
    assert.equal(visitorFacing.name, 'Open-Meteo');
    assert.notEqual(visitorFacing.synthetic, true);
  });
});

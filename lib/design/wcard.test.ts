import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contrast, hexToRgb, TEXT_MIN } from './contrast';

/**
 * The weather card's grounds, measured — every time of day against every sky.
 *
 * THE BUG THIS HOLDS. The card's ground is a gradient chosen by time of day
 * and then adjusted by condition, and the ink comes with the time of day. At
 * night in the rain, the rain's pale daytime ground replaced night's dark one
 * and night's white ink stayed: the place and the temperature, white on pale
 * blue, at the one hour a person checks the weather before bed.
 *
 * Read from chaatak.css, so the test follows the stylesheet. The smallest text
 * on the card is drawn at reduced opacity, so each pair is measured with the
 * ink blended at that opacity — the colour the reader actually sees.
 */

const css = readFileSync(join(process.cwd(), 'app', 'chaatak.css'), 'utf8');

type Vars = { from?: string; to?: string; ink?: string };

/** The custom properties a rule on this exact selector sets. */
function varsFor(selector: string): Vars {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!rule) return {};
  const body = rule[1];
  const read = (name: string) => new RegExp(`--wcard-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(body)?.[1];
  return { from: read('from'), to: read('to'), ink: read('ink') };
}

/** Cascade in order: base, phase, condition, then phase + condition. */
function card(phase: string, condition: string): Required<Vars> {
  const layers = [varsFor('.wcard'), varsFor(`.wcard--${phase}`), varsFor(`.wcard--${condition}`), varsFor(`.wcard--${phase}.wcard--${condition}`)];
  const out: Vars = { from: '#cfe0ea', to: '#eef2f0', ink: '#10202c' };
  for (const layer of layers) {
    if (layer.from) out.from = layer.from;
    if (layer.to) out.to = layer.to;
    if (layer.ink) out.ink = layer.ink;
  }
  return out as Required<Vars>;
}

/** The ink as drawn at `alpha` over `ground`. hexToRgb gives 0–1 channels. */
function blend(ink: string, ground: string, alpha: number): string {
  const a = hexToRgb(ink);
  const b = hexToRgb(ground);
  const hex = (i: number) =>
    Math.round((a[i] * alpha + b[i] * (1 - alpha)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}

/**
 * The faintest text on the card, read from the stylesheet: the lowest opacity
 * any of its small text lines is drawn at.
 */
const FAINTEST = Math.min(
  ...['.wcard__where', '.wcard__condition'].map((selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    const opacity = rule ? /opacity:\s*([\d.]+)/.exec(rule[1])?.[1] : undefined;
    return opacity ? Number(opacity) : 1;
  }),
);

test('every weather-card ground keeps its text readable, at every hour, in every sky', () => {
  const failures: string[] = [];
  for (const phase of ['dawn', 'day', 'dusk', 'night']) {
    for (const condition of ['clear', 'cloud', 'wet', 'storm']) {
      const c = card(phase, condition);
      for (const ground of [c.from, c.to]) {
        const ratio = contrast(blend(c.ink, ground, FAINTEST), ground);
        // A NaN compares false with everything and would pass silently.
        assert.ok(Number.isFinite(ratio), `${phase} + ${condition}: could not measure ${c.ink} on ${ground}`);
        if (ratio < TEXT_MIN) {
          failures.push(`${phase} + ${condition}: ink ${c.ink} on ${ground} at ${FAINTEST} opacity is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\nChange the colour, never the threshold.`);
});

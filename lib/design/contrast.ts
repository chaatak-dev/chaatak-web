/**
 * WCAG 2.1 contrast, measured against the tokens that actually ship.
 *
 * Tokens are parsed out of brand.css rather than duplicated here, so the test
 * can never drift from the stylesheet. Editing a colour and forgetting to
 * re-check it is exactly the failure this guards.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = hex.replace('#', '').trim();
  const full =
    n.length === 3
      ? n
          .split('')
          .map((c) => c + c)
          .join('')
      : n;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
}

/** WCAG relative luminance: 0 is black, 1 is white. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export type Theme = 'light' | 'dark';

/**
 * Reads the hex tokens from brand.css.
 *
 * Dark inherits from light: the dark block only redefines what changes, which
 * is how the stylesheet itself works, so the test has to model it the same way
 * or it would miss pairs that dark silently inherits.
 */
export function tokens(theme: Theme): Record<string, string> {
  const css = readFileSync(join(process.cwd(), 'brand.css'), 'utf8');

  const block = (selector: string): Record<string, string> => {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`brand.css has no ${selector} block`);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close);

    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      out[m[1]] = m[2];
    }
    return out;
  };

  const light = block(':root');
  if (theme === 'light') return light;
  return { ...light, ...block("[data-theme='dark']") };
}

/** Text and icons below 18.66px bold / 24px regular. */
export const TEXT_MIN = 4.5;
/** UI component boundaries and meaningful graphics. */
export const UI_MIN = 3;

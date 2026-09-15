import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TEXT_MIN, UI_MIN, contrast, luminance, tokens } from './contrast';
import type { Theme } from './contrast';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * THIS TEST IS MANDATORY. DO NOT DELETE IT. DO NOT LOWER A THRESHOLD TO
 * MAKE IT PASS — change the colour instead.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SIX PAIRS SHIPPED FAILING BEFORE THIS EXISTED. The dark palette was
 * hand-written and never measured, and the failures were invisible to review
 * because each colour looked fine on its own:
 *
 *   --sev-warning as a 2px rule on paper     1.72:1   needed 3.0
 *   --sev-watch  as a 2px rule on paper      2.65:1   needed 3.0
 *   --sev-none   as a 2px rule on paper      2.87:1   needed 3.0
 *   --sev-alert-ink on the --sev-alert band  3.24:1   needed 4.5
 *   --text-faint on paper                    3.75:1   needed 4.5
 *   --hairline as an input border            1.46:1   needed 3.0
 *
 * The first is the one that matters: the provenance rule under a RED WARNING
 * was invisible in dark mode. Severity is supposed to be the layout, and at
 * 1.72:1 it was not on the page at all.
 *
 * The root cause was a reasonable assumption that happens to hold in light and
 * not in dark: that ONE token could serve both as a band background and as a
 * rule drawn on the page. Those pull in opposite directions on a dark ground —
 * the band wants to be dim so it is not a 3am flashbang, the rule wants to be
 * bright enough to survive near-black. Hence --sev-*  and --sev-*-line.
 *
 * Tokens are read from brand.css, so this follows the stylesheet rather than a
 * copy of it. If you add a colour, add its pairs here too.
 */

type Pair = [label: string, fg: string, bg: string, min: number];

/** Pairs that must hold in BOTH themes. */
const PAIRS: Pair[] = [
  // Body copy and chrome.
  ['text on paper', '--text', '--paper', TEXT_MIN],
  ['text on surface', '--text', '--surface', TEXT_MIN],
  ['text-soft on paper (provenance line)', '--text-soft', '--paper', TEXT_MIN],
  ['text-soft on surface', '--text-soft', '--surface', TEXT_MIN],
  ['text-faint on paper (measurement labels)', '--text-faint', '--paper', TEXT_MIN],
  ['text-faint on surface', '--text-faint', '--surface', TEXT_MIN],

  // The accent marks what is interactive, so it is a UI signal as well as text.
  ['accent on paper (links, focus ring)', '--accent', '--paper', TEXT_MIN],
  ['paper on accent (mic glyph, submit label)', '--paper', '--accent', TEXT_MIN],

  // An input border is a UI component boundary, not decoration.
  ['border-control on paper (input borders)', '--border-control', '--paper', UI_MIN],

  // Severity bands: ink sitting on the band.
  ['sev-none-ink on sev-none band', '--sev-none-ink', '--sev-none', TEXT_MIN],
  ['sev-watch-ink on sev-watch band', '--sev-watch-ink', '--sev-watch', TEXT_MIN],
  ['sev-alert-ink on sev-alert band', '--sev-alert-ink', '--sev-alert', TEXT_MIN],
  ['sev-warning-ink on sev-warning band', '--sev-warning-ink', '--sev-warning', TEXT_MIN],

  // Severity lines: the 2px provenance rule, drawn on the page.
  ['sev-none-line on paper', '--sev-none-line', '--paper', UI_MIN],
  ['sev-watch-line on paper', '--sev-watch-line', '--paper', UI_MIN],
  ['sev-alert-line on paper', '--sev-alert-line', '--paper', UI_MIN],
  ['sev-warning-line on paper', '--sev-warning-line', '--paper', UI_MIN],

  // A stale value loses its severity colour, so the grey rule must still read.
  ['text-soft as the stale rule on paper', '--text-soft', '--paper', UI_MIN],
];

for (const theme of ['light', 'dark'] as Theme[]) {
  test(`${theme} theme: every colour pair meets WCAG`, () => {
    const t = tokens(theme);
    const failures: string[] = [];

    for (const [label, fg, bg, min] of PAIRS) {
      const a = t[fg];
      const b = t[bg];
      assert.ok(a, `${theme}: brand.css is missing ${fg}`);
      assert.ok(b, `${theme}: brand.css is missing ${bg}`);

      const ratio = contrast(a, b);
      if (ratio < min) {
        failures.push(
          `  ${label}\n    ${fg} ${a} on ${bg} ${b}\n` +
            `    ${ratio.toFixed(2)}:1, needs ${min}:1`,
        );
      }
    }

    assert.equal(
      failures.length,
      0,
      `\n${theme} theme has ${failures.length} failing pair(s).\n` +
        `Change the colour, never the threshold.\n\n${failures.join('\n\n')}\n`,
    );
  });
}

test('light severity BANDS are exactly what shipped', () => {
  /*
   * The split was introduced for dark mode, and the intent was that light
   * would come out byte-identical. It did not, and the reason is worth
   * recording: running this fixture against light found six failures there
   * too, including --sev-watch-line at 1.53:1 and --sev-alert-line at 2.14:1
   * on paper. The pale yellow and orange were invisible as provenance rules in
   * LIGHT mode — the same bug as the dark red, mirrored.
   *
   * So the lines had to change in light as well. What must NOT change is the
   * band colours: they are IMD's own scale, they are the severity identity a
   * user recognises, and they are the one thing here that is not ours to
   * adjust for contrast.
   */
  const t = tokens('light');
  const IMD_SCALE: Record<string, string> = {
    '--sev-none': '#639922',
    '--sev-watch': '#FAC775',
    '--sev-alert': '#EF9F27',
    '--sev-warning': '#A32D2D',
  };

  for (const [token, expected] of Object.entries(IMD_SCALE)) {
    assert.equal(
      t[token].toUpperCase(),
      expected,
      `${token} is IMD's scale and must not be adjusted for contrast`,
    );
  }
});

test('a severity line is never paler than its band needs it to be', () => {
  // Where a line differs from its band, it is always because the band was too
  // pale to read as a rule — never the other way round.
  for (const theme of ['light', 'dark'] as Theme[]) {
    const t = tokens(theme);
    for (const name of ['none', 'watch', 'alert', 'warning']) {
      const line = contrast(t[`--sev-${name}-line`], t['--paper']);
      const band = contrast(t[`--sev-${name}`], t['--paper']);
      assert.ok(
        line >= band - 0.01,
        `${theme} --sev-${name}-line (${line.toFixed(2)}:1) reads worse than ` +
          `the band (${band.toFixed(2)}:1), which defeats the point of splitting them`,
      );
    }
  }
});

test('dark severity bands are dimmer than their light counterparts', () => {
  // The 3am rule. A warning that wakes someone at three in the morning has to
  // be readable without being a flashbang, so every dark band sits at lower
  // absolute luminance than the light one it replaces.
  const light = tokens('light');
  const dark = tokens('dark');

  for (const name of ['none', 'watch', 'alert', 'warning']) {
    const key = `--sev-${name}`;
    const l = luminance(light[key]);
    const d = luminance(dark[key]);
    assert.ok(
      d < l,
      `dark ${key} (L=${d.toFixed(4)}) must be dimmer than light (L=${l.toFixed(4)})`,
    );
  }
});

test('dark severity lines are bright enough to survive a near-black ground', () => {
  // The counterweight to the test above: dim bands are correct, but the RULE
  // is drawn ON the dark page and has to go the other way. This is the pair
  // that shipped at 1.72:1.
  const dark = tokens('dark');
  for (const name of ['none', 'watch', 'alert', 'warning']) {
    const ratio = contrast(dark[`--sev-${name}-line`], dark['--paper']);
    assert.ok(
      ratio >= UI_MIN,
      `dark --sev-${name}-line is ${ratio.toFixed(2)}:1 on paper, needs ${UI_MIN}:1`,
    );
  }
});

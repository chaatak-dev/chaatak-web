'use client';

/**
 * System / light / dark. Three buttons, not a cycling switch — a cycling
 * switch hides which mode you are in and costs up to three taps to reach the
 * one you want.
 */

import { useSyncExternalStore } from 'react';
import {
  readThemeChoice,
  subscribeTheme,
  writeThemeChoice,
  type ThemeChoice,
} from '@/lib/theme';

const OPTIONS: { value: ThemeChoice; hi: string; en: string; glyph: string }[] = [
  { value: 'system', hi: 'अपने आप', en: 'System', glyph: 'A' },
  { value: 'light', hi: 'दिन', en: 'Light', glyph: '☀' },
  { value: 'dark', hi: 'रात', en: 'Dark', glyph: '☾' },
];

export function ThemeToggle() {
  const choice = useSyncExternalStore<ThemeChoice>(
    subscribeTheme,
    readThemeChoice,
    // Server snapshot: no stored choice is knowable, so it is system.
    () => 'system',
  );

  return (
    <div className="themetoggle" role="group" aria-label="Theme">
      {OPTIONS.map((option) => {
        const active = option.value === choice;
        return (
          <button
            key={option.value}
            type="button"
            className={`themetoggle__option${active ? ' is-active' : ''}`}
            aria-pressed={active}
            aria-label={option.en}
            onClick={() => writeThemeChoice(option.value)}
          >
            <span aria-hidden="true">{option.glyph}</span>
          </button>
        );
      })}
    </div>
  );
}

'use client';

/**
 * System / light / dark. Three buttons, not a cycling switch — a cycling
 * switch hides which mode you are in and costs up to three taps to reach the
 * one you want.
 *
 * Drawn icons, not ☀ and ☾. A Unicode glyph renders as whatever face the
 * platform happens to have, at whatever weight and baseline that face chose,
 * which on this project sits beside a 1.4px-stroke icon set and a logo mark
 * that were drawn deliberately. These are one stroke weight, one grid.
 */

import { useSyncExternalStore } from 'react';
import {
  readThemeChoice,
  subscribeTheme,
  writeThemeChoice,
  type ThemeChoice,
} from '@/lib/theme';

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function SystemIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <rect x="2.25" y="3" width="13.5" height="9.5" rx="1.5" {...STROKE} />
      <path d="M6.5 15.25h5" {...STROKE} />
    </svg>
  );
}

function LightIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="3.4" {...STROKE} />
      <path
        d="M9 1.9v1.7M9 14.4v1.7M1.9 9h1.7M14.4 9h1.7M3.98 3.98l1.2 1.2M12.82 12.82l1.2 1.2M14.02 3.98l-1.2 1.2M5.18 12.82l-1.2 1.2"
        {...STROKE}
      />
    </svg>
  );
}

function DarkIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M15 10.8A6.4 6.4 0 0 1 7.2 3a6.4 6.4 0 1 0 7.8 7.8Z"
        {...STROKE}
      />
    </svg>
  );
}

const OPTIONS: {
  value: ThemeChoice;
  label: string;
  Icon: () => React.ReactElement;
}[] = [
  { value: 'system', label: 'Match system', Icon: SystemIcon },
  { value: 'light', label: 'Light', Icon: LightIcon },
  { value: 'dark', label: 'Dark', Icon: DarkIcon },
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
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = value === choice;
        return (
          <button
            key={value}
            type="button"
            className={`themetoggle__option${active ? ' is-active' : ''}`}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => writeThemeChoice(value)}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

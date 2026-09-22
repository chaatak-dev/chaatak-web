'use client';

/**
 * The way into the weather map.
 *
 * A compact entry in the rail, not a map squeezed into a 20rem column. A map
 * that small can only show a postage stamp of a country, and it costs a WebGL
 * context and a tile budget to do it — so the rail carries an invitation and
 * the map gets a workspace when somebody actually wants one.
 *
 * MapLibre is loaded only when that happens. It is the largest dependency in
 * this app and nobody asking "will it rain" should pay to download it.
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useApp } from './AppState';

const WeatherMap = dynamic(() => import('./WeatherMap').then((m) => m.WeatherMap), {
  ssr: false,
});

export function MapEntry() {
  const app = useApp();
  const { t, weather } = app;
  const [open, setOpen] = useState(false);

  const place = weather.status === 'ready' ? weather.snapshot.place : null;

  return (
    <>
      <button type="button" className="mapentry" onClick={() => setOpen(true)}>
        {/*
          A hairline suggestion of a coastline, not a picture of a map. A
          real preview would mean loading the map to show a thumbnail of the
          map, which is the cost this entry exists to defer.
        */}
        <svg className="mapentry__preview" viewBox="0 0 120 64" aria-hidden="true">
          <rect width="120" height="64" rx="8" className="mapentry__ground" />
          <path
            d="M18 46 C 34 30, 48 40, 62 28 S 92 16, 106 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            opacity="0.5"
          />
          <circle cx="62" cy="28" r="3.5" className="mapentry__pin" />
        </svg>
        <span className="mapentry__label">{t('rail.openMap')}</span>
      </button>

      {open && <WeatherMap place={place} onClose={() => setOpen(false)} />}
    </>
  );
}

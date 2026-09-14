'use client';

/**
 * The weather query page.
 *
 * Type a place, get current conditions and a three-day outlook, each with the
 * source, the endpoint and the upstream timestamp under it. A place that does
 * not resolve gets a statement, not an error toast.
 *
 * The page renders values; it never computes them. Everything numeric on
 * screen arrived in the response body from /api/weather, which got it from an
 * adapter, which got it from upstream.
 */

import { useRef, useState } from 'react';
import type { WeatherResponse } from '@/lib/weather/api';
import type { NoData } from '@/lib/weather/types';
import { placeLine } from '@/lib/format';
import { CurrentConditions } from './components/CurrentConditions';
import { LogoMark } from './components/LogoMark';
import { NoDataField } from './components/NoDataField';
import { Outlook } from './components/Outlook';
import { WarningSlot } from './components/WarningSlot';

type Status = 'idle' | 'loading' | 'done';

/**
 * Our own failure, not a source's: the request to our route did not complete.
 * Named honestly so nobody reads it as Open-Meteo having gone quiet.
 */
function routeFailure(): NoData {
  return {
    kind: 'noData',
    reason: 'lookupFailed',
    source: 'Chaatak',
    endpoint: '/api/weather',
    checkedAt: new Date().toISOString(),
    statement: {
      hi: 'यह ऐप अपने सर्वर तक नहीं पहुँच सका। इंटरनेट जाँचें और फिर कोशिश करें।',
      en: 'This app could not reach its own server. Check your connection and try again.',
    },
  };
}

/** The reader's own zone, for timestamps that are about us rather than a place. */
function readerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export default function Home() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<WeatherResponse | null>(null);
  const [failure, setFailure] = useState<NoData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setFailure(null);

    try {
      const res = await fetch(`/api/weather?place=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult((await res.json()) as WeatherResponse);
    } catch {
      setResult(null);
      setFailure(routeFailure());
    } finally {
      setStatus('done');
    }
  }

  // Values display in the place's own zone. When no place resolved there is no
  // such zone, and the only timestamp left is when we asked — which is about
  // the reader, so it reads in the reader's zone.
  const timeZone =
    result?.kind === 'resolved' ? result.place.timezone : readerZone();

  const header =
    result?.kind === 'resolved' ? placeLine(result.place) : null;

  return (
    <>
      <header className="masthead">
        <div className="masthead__inner">
          <LogoMark size={40} />
          <div className="masthead__where">
            {header ? (
              <p className="masthead__place">{header}</p>
            ) : (
              <p className="masthead__brand">
                <span lang="hi" className="masthead__brand-hi">
                  चातक
                </span>
                <span className="masthead__brand-en">Chaatak</span>
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="page">
        <form className="query" onSubmit={onSubmit}>
          <label className="query__label" htmlFor="place">
            <span lang="hi" className="query__label-hi">
              जगह का नाम लिखें
            </span>
            <span className="query__label-en">Type a place name</span>
          </label>

          <div className="query__row">
            <input
              id="place"
              ref={inputRef}
              className="query__input"
              type="text"
              name="place"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ghaziabad"
              autoComplete="off"
              autoCapitalize="words"
              enterKeyHint="search"
            />
            <button
              className="query__submit"
              type="submit"
              disabled={status === 'loading'}
              aria-label="Show weather for this place"
            >
              <span lang="hi">देखें</span>
            </button>
          </div>
        </form>

        <div className="results" aria-live="polite" aria-busy={status === 'loading'}>
          {status === 'idle' && (
            <section className="idle">
              <p lang="hi" className="idle__headline">
                किसी जगह का नाम लिखें
              </p>
              <p className="idle__subtitle">
                Current conditions and a three-day outlook, with the source and
                the time it was last updated under every value.
              </p>
            </section>
          )}

          {status === 'loading' && (
            <p className="loading">
              <span lang="hi">जाँच रहे हैं…</span>
              <span className="loading__en">Checking the source…</span>
            </p>
          )}

          {status === 'done' && failure && (
            <NoDataField state={failure} timeZone={timeZone} />
          )}

          {status === 'done' && result?.kind === 'unresolved' && (
            <NoDataField state={result.noData} timeZone={timeZone} />
          )}

          {status === 'done' && result?.kind === 'resolved' && (
            <>
              <WarningSlot warnings={result.warnings} timeZone={timeZone} />
              <CurrentConditions reading={result.current} timeZone={timeZone} />
              <Outlook forecast={result.outlook} timeZone={timeZone} />
            </>
          )}
        </div>
      </main>

      <footer className="colophon">
        <p>
          Chaatak shows India Meteorological Department bulletins. IMD API
          access is pending, so values here come from Open-Meteo and are
          labelled as such. No value on this page is generated by Chaatak.
        </p>
      </footer>
    </>
  );
}

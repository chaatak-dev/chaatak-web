'use client';

/**
 * Monitored locations: up to three places watched whether or not anyone is
 * looking at the app.
 *
 * TWO SEPARATE DECISIONS, and the panel keeps them separate:
 *
 *   1. Which places to watch. Saved to the account, synced across devices,
 *      and used by the alert daemon. No permission of any kind is involved.
 *   2. Whether to be interrupted by a notification. A browser permission,
 *      asked for once, at the moment someone presses the control that says
 *      what it will do — and never as a consequence of saving a place.
 *
 * Fusing them is the common mistake and it costs both: the notification
 * prompt arrives before the person has decided they want alerts, they press
 * block, and the one channel that could wake them about a cyclone is closed
 * for good.
 *
 * The limit is not enforced here. The server refuses a fourth location on a
 * unique constraint and this panel reports what it said — a count in the
 * browser is a hint, never the rule.
 */

import { useState } from 'react';
import { useApp } from './AppState';
import { signInWithGoogle } from '@/lib/auth/browser';
import { currentPosition, geoSupported } from '@/lib/geo';
import type { MonitoredLocation } from '@/lib/accounts/types';
import type { StringKey } from '@/lib/i18n/strings';

/**
 * What the panel has to say, as a key rather than a sentence — except for the
 * resolver's own statement, which is already written in both languages
 * upstream and is not re-worded here.
 */
type Notice =
  | null
  | { kind: 'duplicate'; existing: MonitoredLocation }
  | { kind: 'full' }
  | { kind: 'unresolved'; statement: { hi: string; en: string } }
  | { kind: 'error'; message: string }
  | { kind: 'geo'; key: StringKey };

export function LocationsPanel() {
  const app = useApp();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const { locations, limit, used, remaining } = app.locations;

  if (!app.configured) return null;

  /* Signed out: say what an account buys, and nothing more. */
  if (!app.user) {
    return (
      <section className="places">
        <h2 className="sidebar__heading">{app.t('nav.monitored')}</h2>
        <p className="places__invite">{app.t('places.inviteHeadline')}</p>
      </section>
    );
  }

  async function addByName(event: React.FormEvent) {
    event.preventDefault();
    const place = query.trim();
    if (!place || busy) return;

    setBusy(true);
    setNotice(null);
    const outcome = await app.addLocation({ place });
    setBusy(false);

    if (outcome.ok) {
      setQuery('');
      return;
    }

    if (outcome.reason === 'duplicate') {
      setNotice({ kind: 'duplicate', existing: outcome.existing });
    } else if (outcome.reason === 'full') {
      setNotice({ kind: 'full' });
    } else if (outcome.reason === 'unresolved') {
      // The statement upstream wrote, in both languages, not one composed here.
      setNotice({ kind: 'unresolved', statement: outcome.noData.statement });
    } else {
      setNotice({ kind: 'error', message: outcome.error });
    }
  }

  /**
   * Save where the person is standing.
   *
   * The permission prompt happens here, because they pressed this. What gets
   * stored is the place the coordinate resolved to — a town in the gazetteer
   * — and never the coordinate itself.
   */
  async function addHere() {
    if (busy) return;

    setBusy(true);
    setNotice(null);

    const fix = await currentPosition();
    if (!fix.ok) {
      setBusy(false);
      setNotice({
        kind: 'geo',
        key: fix.reason === 'denied' ? 'places.geoDenied' : 'places.geoFailed',
      });
      return;
    }

    const outcome = await app.addLocation(fix.coords);
    setBusy(false);

    if (outcome.ok) return;

    if (outcome.reason === 'duplicate') {
      setNotice({ kind: 'duplicate', existing: outcome.existing });
    } else if (outcome.reason === 'full') {
      setNotice({ kind: 'full' });
    } else if (outcome.reason === 'unresolved') {
      setNotice({ kind: 'unresolved', statement: outcome.noData.statement });
    } else {
      setNotice({ kind: 'error', message: outcome.error });
    }
  }

  return (
    <section className="places">
      <h2 className="sidebar__heading">
        {app.t('nav.monitored')}
        <span className="places__count">
          {app.t('places.count', { used, limit })}
        </span>
      </h2>

      <ul className="places__list">
        {locations.map((location) => (
          <li key={location.id} className="places__item">
            <div className="places__what">
              <p className="places__name">{location.placeName}</p>
              {/*
                The district, unless the place IS the district — "Barabanki,
                Barabanki · Uttar Pradesh" says the same word twice and reads
                like a bug.
              */}
              <p className="places__where">
                {[
                  location.district === location.placeName ? null : location.district,
                  location.state,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {/*
                Whether this place is actually being watched, said in words
                rather than with a coloured dot. "Saved" and "being watched"
                are different states and the difference is the whole point of
                the alert pipeline.
              */}
              <p
                className={`places__status${
                  app.alerts.enabled ? ' places__status--on' : ''
                }`}
              >
                {app.t(app.alerts.enabled ? 'places.alertsOn' : 'places.alertsOff')}
              </p>
            </div>

            <button
              type="button"
              className="places__remove"
              onClick={() => void app.removeLocation(location.id)}
              aria-label={app.t('places.remove', { place: location.placeName })}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>

      {remaining > 0 ? (
        <form className="places__add" onSubmit={addByName}>
          <input
            className="places__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={app.t('places.addPlaceholder')}
            aria-label={app.t('places.addLabel')}
            autoComplete="off"
            disabled={busy}
          />
          <button
            type="submit"
            className="places__submit"
            disabled={busy || !query.trim()}
          >
            {app.t('places.add')}
          </button>
        </form>
      ) : (
        <p className="places__full">{app.t('places.full')}</p>
      )}

      {remaining > 0 && geoSupported() && (
        <button
          type="button"
          className="places__here"
          onClick={() => void addHere()}
          disabled={busy}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.4" fill="currentColor" />
            <circle
              cx="8"
              cy="8"
              r="5.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
          </svg>
          {app.t('places.addHere')}
        </button>
      )}

      {notice && (
        <p className="places__notice" role="status">
          {notice.kind === 'duplicate' &&
            app.t('places.duplicate', {
              district: notice.existing.district,
              place: notice.existing.placeName,
            })}
          {notice.kind === 'full' && app.t('places.full')}
          {/* The resolver wrote this in both languages; it is shown, not
              re-worded, because it is the same statement the chat gives. */}
          {notice.kind === 'unresolved' && notice.statement[app.languages.ui]}
          {notice.kind === 'geo' && app.t(notice.key)}
          {notice.kind === 'error' && notice.message}
        </p>
      )}

    </section>
  );
}

/** The sign-in control, used wherever an account feature is reached for. */
export function SignInButton({ label }: { label?: string }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        className="signin"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void signInWithGoogle(window.location.pathname).then((result) => {
            if (result.error) {
              setBusy(false);
              setError(result.error);
            }
            // On success the browser is already navigating to Google; there
            // is nothing to re-enable.
          });
        }}
      >
        <svg viewBox="0 0 18 18" aria-hidden="true" className="signin__mark">
          <path
            fill="#4285F4"
            d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
          />
          <path
            fill="#34A853"
            d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
          />
          <path
            fill="#FBBC05"
            d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
          />
          <path
            fill="#EA4335"
            d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
          />
        </svg>
        {label ?? app.t('account.signIn')}
      </button>
      {error && (
        <p className="places__notice" role="status">
          {error}
        </p>
      )}
    </>
  );
}

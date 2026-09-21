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

type Notice =
  | null
  | { kind: 'duplicate'; existing: MonitoredLocation }
  | { kind: 'full' }
  | { kind: 'unresolved'; statement: { hi: string; en: string } }
  | { kind: 'error'; message: string }
  | { kind: 'geo'; hi: string; en: string };

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
        <h2 className="sidebar__heading">
          <span lang="hi">निगरानी</span>
          <span className="sidebar__heading-en">Monitored</span>
        </h2>
        <p className="places__invite" lang="hi">
          तीन जगहें सहेजें और चेतावनी अपने आप पाएँ — इसके लिए साइन इन करें।
        </p>
        <p className="places__invite-en">
          Save up to three places and be warned without asking. Needs an
          account.
        </p>
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
        hi:
          fix.reason === 'denied'
            ? 'इस साइट के लिए जगह की अनुमति बंद है। जगह का नाम लिखें।'
            : 'आपकी जगह पता नहीं चल सकी। जगह का नाम लिखें।',
        en:
          fix.reason === 'denied'
            ? 'Location is blocked for this site. Type a place name instead.'
            : 'Could not get a location fix. Type a place name instead.',
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
        <span lang="hi">निगरानी</span>
        <span className="sidebar__heading-en">Monitored</span>
        <span className="places__count">
          {used} of {limit}
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
                <span lang="hi">
                  {app.alerts.enabled ? 'चेतावनी चालू' : 'सहेजा · चेतावनी बंद'}
                </span>
                <span className="places__status-en">
                  {app.alerts.enabled ? 'Alerts on' : 'Saved · alerts off'}
                </span>
              </p>
            </div>

            <button
              type="button"
              className="places__remove"
              onClick={() => void app.removeLocation(location.id)}
              aria-label={`Stop monitoring ${location.placeName}`}
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
            placeholder="जगह जोड़ें · Add a place"
            aria-label="Add a place to monitor"
            autoComplete="off"
            disabled={busy}
          />
          <button
            type="submit"
            className="places__submit"
            disabled={busy || !query.trim()}
          >
            <span lang="hi">जोड़ें</span>
            <span className="places__submit-en">Add</span>
          </button>
        </form>
      ) : (
        <p className="places__full">
          <span lang="hi">
            तीन जगहों तक ही रख सकते हैं। नई जोड़ने के लिए एक हटाएँ।
          </span>
          <span className="places__full-en">
            Three places is the limit. Remove one to add another.
          </span>
        </p>
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
          <span lang="hi">मैं जहाँ हूँ वह जोड़ें</span>
          <span className="places__here-en">Add where I am</span>
        </button>
      )}

      {notice && (
        <p className="places__notice" role="status">
          {notice.kind === 'duplicate' && (
            <>
              <span lang="hi">
                {notice.existing.district} पहले से {notice.existing.placeName} में
                शामिल है।
              </span>
              <span className="places__notice-en">
                {notice.existing.district} is already covered by{' '}
                {notice.existing.placeName}.
              </span>
            </>
          )}
          {notice.kind === 'full' && (
            <>
              <span lang="hi">
                तीन जगहों तक ही रख सकते हैं। नई जोड़ने के लिए एक हटाएँ।
              </span>
              <span className="places__notice-en">
                Three places is the limit. Remove one to add another.
              </span>
            </>
          )}
          {notice.kind === 'unresolved' && (
            <>
              <span lang="hi">{notice.statement.hi}</span>
              <span className="places__notice-en">{notice.statement.en}</span>
            </>
          )}
          {notice.kind === 'geo' && (
            <>
              <span lang="hi">{notice.hi}</span>
              <span className="places__notice-en">{notice.en}</span>
            </>
          )}
          {notice.kind === 'error' && notice.message}
        </p>
      )}

      <AlertsControl />
    </section>
  );
}

/**
 * The notification switch.
 *
 * Deliberately its own block, below the places, with its own words. A person
 * reading this should be able to see that saving a place did not turn this on
 * and that turning this on did not save a place.
 */
function AlertsControl() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ hi: string; en: string } | null>(null);

  const blocked = app.pushPermission === 'denied';
  const unsupported = app.pushPermission === 'unsupported' || !app.pushAvailable;

  async function enable() {
    setBusy(true);
    setProblem(null);
    const result = await app.enableAlerts();
    setBusy(false);

    if (result.ok) return;

    setProblem(
      result.reason === 'denied'
        ? {
            hi: 'इस साइट के लिए सूचनाएँ बंद हैं। आपकी जगहें फिर भी सहेजी हैं।',
            en: 'Notifications are blocked for this site. Your places are still saved.',
          }
        : result.reason === 'unsupported'
          ? {
              hi: 'यह ब्राउज़र सूचनाएँ नहीं भेज सकता।',
              en: 'This browser cannot receive push notifications.',
            }
          : result.reason === 'unavailable'
            ? {
                hi: 'इस साइट पर सूचनाएँ अभी उपलब्ध नहीं हैं।',
                en: 'Push is not configured on this deployment.',
              }
            : {
                hi: 'चेतावनी चालू नहीं हो सकी। फिर कोशिश करें।',
                en: 'Could not switch alerts on. Try again.',
              },
    );
  }

  return (
    <div className="alertctl">
      <p className="alertctl__state">
        <span lang="hi">चेतावनी सूचना</span>
        <span className="alertctl__state-en">
          {app.alerts.enabled ? 'Alerts on for this account' : 'Alerts off'}
        </span>
      </p>

      {app.alerts.enabled ? (
        <button
          type="button"
          className="alertctl__button"
          onClick={() => void app.disableAlerts()}
        >
          <span lang="hi">इस डिवाइस पर बंद करें</span>
          <span className="alertctl__button-en">Turn off on this device</span>
        </button>
      ) : unsupported ? (
        <p className="alertctl__note">
          <span lang="hi">
            यहाँ सूचनाएँ उपलब्ध नहीं हैं। सहेजी जगहें फिर भी काम करती हैं —
            चेतावनी देखने के लिए चातक खोलें।
          </span>
          <span className="alertctl__note-en">
            Push notifications are not available here. Saved places still work —
            open Chaatak to see their warnings.
          </span>
        </p>
      ) : blocked ? (
        <p className="alertctl__note">
          <span lang="hi">
            ब्राउज़र की सेटिंग में इस साइट की सूचनाएँ बंद हैं। सहेजी जगहें फिर भी
            काम करती हैं — चेतावनी देखने के लिए चातक खोलें।
          </span>
          <span className="alertctl__note-en">
            Notifications are blocked for this site in your browser settings.
            Saved places still work; open Chaatak to see their warnings.
          </span>
        </p>
      ) : (
        <button
          type="button"
          className="alertctl__button alertctl__button--on"
          onClick={() => void enable()}
          disabled={busy}
        >
          <span lang="hi">
            {busy ? 'पूछ रहे हैं…' : 'इन जगहों की चेतावनी भेजें'}
          </span>
          <span className="alertctl__button-en">
            {busy ? 'Asking…' : 'Warn me about these places'}
          </span>
        </button>
      )}

      {problem && (
        <p className="alertctl__note" role="status">
          <span lang="hi">{problem.hi}</span>
          <span className="alertctl__note-en">{problem.en}</span>
        </p>
      )}
    </div>
  );
}

/** The sign-in control, used wherever an account feature is reached for. */
export function SignInButton({ label }: { label?: string }) {
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
        {label ?? 'Sign in with Google'}
      </button>
      {error && (
        <p className="places__notice" role="status">
          {error}
        </p>
      )}
    </>
  );
}

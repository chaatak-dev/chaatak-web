'use client';

/**
 * Telegram, as one more place alerts can reach.
 *
 * Lives in the alert section of settings because that is what it is: a
 * channel, beside browser push, for the same monitored places. Connecting it
 * is a decision made here, by pressing a control that says what it does —
 * the same rule browser notifications follow.
 *
 * THE FLOW, in two taps. "Connect Telegram" asks the server for a one-time
 * link; it comes back as "Open Telegram", a real link the person follows, so
 * no popup blocker is involved. Telegram asks them to confirm which account
 * they are connecting. Meanwhile this checks back — every few seconds, and
 * the moment the tab regains focus — and turns into "Connected as @name"
 * without a reload.
 *
 * Absent entirely when the deployment has no bot, rather than a button that
 * cannot work.
 */

import { useEffect, useState } from 'react';
import {
  createTelegramLink,
  disconnectTelegram,
  fetchTelegram,
  type TelegramState,
} from '@/lib/accounts/client';
import { useApp } from './AppState';
import { ConfirmDialog } from './ConfirmDialog';

type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'waiting'; url: string; minutes: number; until: number }
  | { kind: 'failed' }
  | { kind: 'expired' };

/** How often to look for the link having been used, while it is open. */
const POLL_MS = 4_000;

export function TelegramControl() {
  const app = useApp();
  const { t, noteAlerts } = app;
  const [state, setState] = useState<TelegramState | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchTelegram().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase.kind !== 'waiting') return;

    let cancelled = false;
    const check = async () => {
      const next = await fetchTelegram();
      if (cancelled || !next) return;
      if (next.connected) {
        setState(next);
        setPhase({ kind: 'idle' });
        noteAlerts(next.alerts);
      } else if (Date.now() > phase.until) {
        setPhase({ kind: 'expired' });
      }
    };

    const timer = window.setInterval(() => void check(), POLL_MS);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [phase, noteAlerts]);

  if (!state || !state.available) return null;

  async function connect() {
    setPhase({ kind: 'preparing' });
    const link = await createTelegramLink();
    if (!link.ok) {
      setPhase({ kind: 'failed' });
      return;
    }
    setPhase({
      kind: 'waiting',
      url: link.url,
      minutes: link.minutes,
      until: Date.now() + link.minutes * 60_000,
    });
  }

  async function disconnect() {
    setConfirming(false);
    const next = await disconnectTelegram();
    if (next) {
      setState(next);
      noteAlerts(next.alerts);
    }
  }

  return (
    <div className="alertctl tgctl">
      <p className="alertctl__state">
        <span className="alertctl__state-name">{t('telegram.heading')}</span>
        <span className="alertctl__state-en">
          {state.connected
            ? state.displayName
              ? t('telegram.connectedAs', { name: state.displayName })
              : t('telegram.connected')
            : t('telegram.notConnected')}
        </span>
      </p>

      {state.connected ? (
        <>
          <p className="alertctl__note">
            {t(state.alertsHere ? 'telegram.alertsOn' : 'telegram.alertsPaused')}
          </p>
          <button type="button" className="alertctl__button" onClick={() => setConfirming(true)}>
            {t('telegram.disconnect')}
          </button>
          <ConfirmDialog
            open={confirming}
            headline="confirm.telegram.headline"
            body="confirm.telegram.body"
            confirmLabel="confirm.telegram.confirm"
            onCancel={() => setConfirming(false)}
            onConfirm={() => void disconnect()}
          />
        </>
      ) : phase.kind === 'waiting' ? (
        <>
          <a
            className="alertctl__button alertctl__button--on tgctl__open"
            href={phase.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('telegram.open')}
          </a>
          <p className="alertctl__note" role="status">
            {t('telegram.waiting', { minutes: phase.minutes })}
          </p>
        </>
      ) : (
        <>
          <p className="alertctl__note">{t('telegram.pitch')}</p>
          <button
            type="button"
            className="alertctl__button alertctl__button--on"
            onClick={() => void connect()}
            disabled={phase.kind === 'preparing'}
          >
            {t(phase.kind === 'preparing' ? 'telegram.preparing' : 'telegram.connect')}
          </button>
          {(phase.kind === 'failed' || phase.kind === 'expired') && (
            <p className="alertctl__note" role="status">
              {t(phase.kind === 'failed' ? 'telegram.failed' : 'telegram.expired')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

'use client';

/**
 * The account block at the foot of the sidebar: who is signed in, and the
 * things that are only true of them.
 *
 * Signing out and deleting an account sit next to each other, so both are
 * worded to be unmistakable and only one of them is styled as destructive.
 * Deletion asks first, and the dialog says what goes — conversations,
 * messages, monitored locations, alerts — because "delete account" on its own
 * does not tell anyone which of those they are about to lose.
 */

import { useEffect, useRef, useState } from 'react';
import { useApp } from './AppState';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingsDialog } from './SettingsDialog';
import { SignInButton } from './LocationsPanel';

type Pending = null | 'signout' | 'delete-account' | 'delete-chats';

/**
 * The way into settings, for an account and for a guest alike.
 *
 * Reachable without signing in on purpose: the interface language is not an
 * account feature, and somebody who has never signed in still needs to read
 * the app in their own language.
 */
function SettingsButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useApp();
  return (
    <button type="button" className="account__settings" onClick={onOpen}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7L3.5 3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      {t('settings.open')}
    </button>
  );
}

export function AccountMenu() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const blockRef = useRef<HTMLDivElement>(null);

  // A menu that stays open after a click elsewhere is a menu that covers the
  // thing that was clicked.
  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (!blockRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!app.configured) {
    /*
     * Accounts are switched off on this deployment, so there is nothing to
     * sign into — but the interface language is not an account feature, and
     * hiding the whole block hid the only way to change it. The settings stay;
     * the sign-in does not.
     */
    return (
      <div className="account account--out">
        <SettingsButton onOpen={() => setSettingsOpen(true)} />
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    );
  }

  if (!app.user) {
    return (
      <div className="account account--out">
        <SettingsButton onOpen={() => setSettingsOpen(true)} />
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <SignInButton />
        <p className="account__why">{app.t('account.why')}</p>
        {app.signInError && (
          <p className="account__error" role="status">
            {app.signInError}
          </p>
        )}
      </div>
    );
  }

  const { user } = app;
  const display = user.name ?? user.email ?? app.t('account.signedIn');
  const initial = (user.name ?? user.email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="account" ref={blockRef}>
      {open && (
        <div className="account__menu" role="menu">
          <button
            type="button"
            className="account__action"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          >
            {app.t('settings.open')}
          </button>

          <button
            type="button"
            className="account__action"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPending('delete-chats');
            }}
          >
            {app.t('account.deleteAll')}
          </button>

          <button
            type="button"
            className="account__action"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPending('signout');
            }}
          >
            {app.t('account.signOut')}
          </button>

          <button
            type="button"
            className="account__action account__action--danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPending('delete-account');
            }}
          >
            {app.t('account.delete')}
          </button>
        </div>
      )}

      <button
        type="button"
        className="account__button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={app.t('account.menu')}
        onClick={() => setOpen((was) => !was)}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="account__avatar"
            src={user.avatarUrl}
            alt=""
            width={30}
            height={30}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="account__avatar account__avatar--letter" aria-hidden="true">
            {initial}
          </span>
        )}

        <span className="account__who">
          <span className="account__name">{display}</span>
          {user.email && <span className="account__email">{user.email}</span>}
        </span>

        <svg className="account__chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 7.5L6 4l3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {error && (
        <p className="account__error" role="status">
          {error}
        </p>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <ConfirmDialog
        open={pending === 'signout'}
        headline="confirm.signOut.headline"
        body="confirm.signOut.body"
        confirmLabel="confirm.signOut.confirm"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null);
          void app.signOut();
        }}
      />

      <ConfirmDialog
        open={pending === 'delete-chats'}
        headline="confirm.deleteAll.headline"
        body="confirm.deleteAll.body"
        confirmLabel="confirm.deleteAll.confirm"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null);
          void app.removeAll();
        }}
      />

      <ConfirmDialog
        open={pending === 'delete-account'}
        headline="confirm.deleteAccount.headline"
        body="confirm.deleteAccount.body"
        confirmLabel="confirm.deleteAccount.confirm"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null);
          setError(null);
          void app.deleteAccount().then((result) => {
            if (!result.ok) setError(result.error ?? app.t('account.deleteFailed'));
          });
        }}
      />
    </div>
  );
}

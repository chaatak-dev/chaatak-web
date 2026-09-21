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
import { SignInButton } from './LocationsPanel';

type Pending = null | 'signout' | 'delete-account' | 'delete-chats';

export function AccountMenu() {
  const app = useApp();
  const [open, setOpen] = useState(false);
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
    // Accounts are switched off on this deployment. Saying nothing is better
    // than a sign-in button that cannot work.
    return null;
  }

  if (!app.user) {
    return (
      <div className="account account--out">
        <SignInButton />
        <p className="account__why">
          Keeps your chats and up to three monitored places, on every device.
        </p>
        {app.signInError && (
          <p className="account__error" role="status">
            {app.signInError}
          </p>
        )}
      </div>
    );
  }

  const { user } = app;
  const display = user.name ?? user.email ?? 'Signed in';
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
              setPending('delete-chats');
            }}
          >
            Delete all chats
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
            Sign out
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
            Delete account
          </button>
        </div>
      )}

      <button
        type="button"
        className="account__button"
        aria-expanded={open}
        aria-haspopup="menu"
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

      <ConfirmDialog
        open={pending === 'signout'}
        headline="साइन आउट करें?"
        headlineEn="Sign out?"
        body="आपकी बातचीत और जगहें सुरक्षित रहेंगी। दोबारा साइन इन करने पर फिर मिल जाएँगी।"
        bodyEn="Your chats and monitored places stay safe. They are here again when you sign back in."
        confirmLabel="साइन आउट"
        confirmLabelEn="Sign out"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null);
          void app.signOut();
        }}
      />

      <ConfirmDialog
        open={pending === 'delete-chats'}
        headline="सारी बातचीत मिटाएँ?"
        headlineEn="Delete all chats?"
        body="हर बातचीत और उसके सारे संदेश हमेशा के लिए मिट जाएँगे। निगरानी वाली जगहें और चेतावनियाँ वैसी ही रहेंगी।"
        bodyEn="Every conversation and all its messages go, permanently. Your monitored places and alerts are not affected."
        confirmLabel="सब मिटाएँ"
        confirmLabelEn="Delete all"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null);
          void app.removeAll();
        }}
      />

      <ConfirmDialog
        open={pending === 'delete-account'}
        headline="खाता मिटाएँ?"
        headlineEn="Delete account?"
        body="बातचीत, संदेश, निगरानी वाली जगहें और चेतावनियाँ — सब हमेशा के लिए मिट जाएगा। यह वापस नहीं आ सकता।"
        bodyEn="Conversations, messages, monitored places and alerts are all deleted permanently. This cannot be undone."
        confirmLabel="खाता मिटाएँ"
        confirmLabelEn="Delete account"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          setPending(null);
          setError(null);
          void app.deleteAccount().then((result) => {
            if (!result.ok) setError(result.error ?? 'Could not delete the account.');
          });
        }}
      />
    </div>
  );
}

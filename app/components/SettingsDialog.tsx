'use client';

/**
 * The settings surface. One of them, reached from one place.
 *
 * Everything that used to live in a permanent rail beside the conversation is
 * here: language, appearance, notifications, and the account itself. That rail
 * was a settings panel occupying a third of a desktop screen at all times, to
 * hold four controls somebody touches twice a year — and it was sitting where
 * the weather belongs.
 *
 * Reachable by a GUEST as well as an account, because the interface language
 * is not an account feature. Someone who has never signed in still needs to
 * read the app in Hindi.
 *
 * A native <dialog>, like every other modal here: focus trapping, Escape and
 * the backdrop come with it rather than being rebuilt.
 */

import { useEffect, useRef } from 'react';
import { useApp } from './AppState';
import { LanguagePanel } from './LanguagePanel';
import { ThemeToggle } from './ThemeToggle';
import { AlertsControl } from './AlertsControl';
import { TelegramControl } from './TelegramControl';

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const app = useApp();
  const { t } = app;
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="settings"
      aria-label={t('settings.title')}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className="settings__head">
        <h2 className="settings__title">{t('settings.title')}</h2>
        <button
          ref={closeRef}
          type="button"
          className="settings__close"
          onClick={onClose}
          aria-label={t('nav.close')}
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
      </div>

      <div className="settings__body">
        <section className="settings__section">
          <h3 className="settings__heading">{t('settings.heading')}</h3>
          <LanguagePanel />
        </section>

        <section className="settings__section">
          <h3 className="settings__heading">{t('settings.theme')}</h3>
          <ThemeToggle />
        </section>

        {/*
          Notifications are an account feature — there is nowhere to dispatch
          to without one — so this section is simply absent for a guest rather
          than shown as a control that cannot work.
        */}
        {app.user && (
          <section className="settings__section">
            <h3 className="settings__heading">{t('alerts.heading')}</h3>
            <AlertsControl />
            {/*
              A second channel for the same places, not a second alert system.
              Mounted only while settings is open, so it costs no request on
              every page load.
            */}
            {open && <TelegramControl />}
          </section>
        )}
      </div>
    </dialog>
  );
}

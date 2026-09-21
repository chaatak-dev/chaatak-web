'use client';

/**
 * Confirming something that cannot be undone.
 *
 * A native <dialog> rather than a div with a high z-index: it traps focus,
 * closes on Escape and is announced as a dialog, all without a line of code
 * here. Rebuilding that by hand is how a confirmation ends up impossible to
 * dismiss with a keyboard.
 *
 * The destructive action is never the default focus. Opening a dialog and
 * pressing Enter out of habit should cancel, not delete.
 *
 * Callers pass STRING KEYS, not sentences. A dialog is the last thing someone
 * reads before losing data, so it is the last place a half-translated screen
 * is acceptable — keys mean it cannot be assembled from two languages by
 * accident, and it renders in whatever the interface language is at the
 * moment it opens.
 */

import { useEffect, useRef } from 'react';
import { useApp } from './AppState';
import type { StringKey } from '@/lib/i18n/strings';

export type ConfirmDialogProps = {
  open: boolean;
  headline: StringKey;
  body: StringKey;
  confirmLabel: StringKey;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  headline,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      // Escape fires `cancel`, and the state has to follow or the dialog
      // reopens on the next render.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClose={onCancel}
    >
      <h2 className="confirm__headline">{t(headline)}</h2>
      <p className="confirm__body">{t(body)}</p>

      <div className="confirm__actions">
        <button
          ref={cancelRef}
          type="button"
          className="confirm__cancel"
          onClick={onCancel}
        >
          {t('confirm.cancel')}
        </button>
        <button type="button" className="confirm__confirm" onClick={onConfirm}>
          {t(confirmLabel)}
        </button>
      </div>
    </dialog>
  );
}

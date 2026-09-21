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
 */

import { useEffect, useRef } from 'react';

export type ConfirmDialogProps = {
  open: boolean;
  /** Hindi first: it is the primary language in the type hierarchy. */
  headline: string;
  headlineEn: string;
  body: string;
  bodyEn: string;
  confirmLabel: string;
  confirmLabelEn: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  headline,
  headlineEn,
  body,
  bodyEn,
  confirmLabel,
  confirmLabelEn,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
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
      <h2 className="confirm__headline" lang="hi">
        {headline}
      </h2>
      <p className="confirm__headline-en">{headlineEn}</p>

      <p className="confirm__body" lang="hi">
        {body}
      </p>
      <p className="confirm__body-en">{bodyEn}</p>

      <div className="confirm__actions">
        <button
          ref={cancelRef}
          type="button"
          className="confirm__cancel"
          onClick={onCancel}
        >
          <span lang="hi">रहने दें</span>
          <span className="confirm__en">Cancel</span>
        </button>
        <button type="button" className="confirm__confirm" onClick={onConfirm}>
          <span lang="hi">{confirmLabel}</span>
          <span className="confirm__en">{confirmLabelEn}</span>
        </button>
      </div>
    </dialog>
  );
}

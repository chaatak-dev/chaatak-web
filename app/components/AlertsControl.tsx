'use client';

/**
 * The notification switch.
 *
 * Lives in settings rather than beside the list of places, because it is one
 * decision about this account and not a property of any one place. The places
 * themselves still say whether they are being watched — that is a status, and
 * a status belongs next to the thing it describes.
 *
 * SEPARATE FROM SAVING A PLACE, which is the point. Saving somewhere and
 * agreeing to be woken by it at 3am are different decisions, and a product
 * that takes the second on the strength of the first is how people end up
 * blocking notifications for the one app with something urgent to say. The
 * browser permission prompt happens here, when this is pressed, and nowhere
 * else.
 */

import { useState } from 'react';
import { useApp } from './AppState';
import type { StringKey } from '@/lib/i18n/strings';

/**
 * The notification switch.
 *
 * Deliberately its own block, below the places, with its own words. A person
 * reading this should be able to see that saving a place did not turn this on
 * and that turning this on did not save a place.
 */
export function AlertsControl() {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StringKey | null>(null);

  const blocked = app.pushPermission === 'denied';
  const unsupported = app.pushPermission === 'unsupported' || !app.pushAvailable;
  /*
   * The button is about browser push; the status line is about the account.
   * They used to be one condition, which was true while push was the only
   * channel — with Telegram connected, "alerts on" offered "turn off on this
   * device" to a device that had nothing to turn off.
   */
  const pushOn = app.alerts.channels.webpush > 0;

  async function enable() {
    setBusy(true);
    setProblem(null);
    const result = await app.enableAlerts();
    setBusy(false);

    if (result.ok) return;

    setProblem(
      result.reason === 'denied'
        ? 'alerts.deniedNow'
        : result.reason === 'unsupported'
          ? 'alerts.unsupported'
          : result.reason === 'unavailable'
            ? 'alerts.unavailable'
            : 'alerts.failed',
    );
  }

  return (
    <div className="alertctl">
      <p className="alertctl__state">
        <span className="alertctl__state-name">{app.t('alerts.heading')}</span>
        <span className="alertctl__state-en">
          {app.t(app.alerts.enabled ? 'alerts.on' : 'alerts.off')}
        </span>
      </p>

      {pushOn ? (
        <button
          type="button"
          className="alertctl__button"
          onClick={() => void app.disableAlerts()}
        >
          {app.t('alerts.disable')}
        </button>
      ) : unsupported ? (
        <p className="alertctl__note">{app.t('alerts.unsupported')}</p>
      ) : blocked ? (
        <p className="alertctl__note">{app.t('alerts.blocked')}</p>
      ) : (
        <button
          type="button"
          className="alertctl__button alertctl__button--on"
          onClick={() => void enable()}
          disabled={busy}
        >
          {app.t(
            busy
              ? 'alerts.enabling'
              : app.alerts.enabled
                ? 'alerts.enableDevice'
                : 'alerts.enable',
          )}
        </button>
      )}

      {problem && (
        <p className="alertctl__note" role="status">
          {app.t(problem)}
        </p>
      )}
    </div>
  );
}


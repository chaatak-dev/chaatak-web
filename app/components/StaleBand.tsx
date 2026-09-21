/**
 * The stale band.
 *
 * Same slot and same weight as a severity band, because this is the provenance
 * problem wearing different clothes: a cached value shown without its age is
 * the same failure as a number shown without its source. Not a corner badge,
 * not fine print.
 *
 * Renders on first paint from localStorage — it never waits on a request to
 * time out, because a cached answer that looks current for three seconds
 * before the offline notice arrives is the same lie with a shorter life.
 */

'use client';

import { ageLabel } from '@/lib/offline/cache';
import { useApp } from './AppState';

type Props = {
  ageMinutes: number;
  /** True once the cached warning's own validity window has elapsed. */
  expired: boolean;
  /** Where the cached value came from, and when it said it was issued. */
  source: string;
  issuedAtLabel: string;
  offline: boolean;
};

export function StaleBand({
  ageMinutes,
  expired,
  source,
  issuedAtLabel,
  offline,
}: Props) {
  const { t, languages } = useApp();

  // The age is written in the same language as the sentence around it.
  // Reusing one label put "40 मिनट पहले" into an English sentence, which is
  // exactly the kind of seam that makes a warning look machine-assembled at
  // the moment it most needs to be trusted.
  const age = ageLabel(ageMinutes, languages.ui);

  /*
   * An expired warning is NOT shown as a warning. A red bulletin that ended at
   * 16:30, surfaced offline at 19:00, reads as live danger — so past its
   * window it stops being a warning and becomes an admission that we cannot
   * say what is current.
   */
  if (expired) {
    return (
      <section className="absence absence--nodata stale stale--expired" role="status">
        <p className="absence__label">{t('stale.expired')}</p>
        <p className="absence__statement">
          {t(offline ? 'stale.expiredBodyOffline' : 'stale.expiredBody', {
            time: issuedAtLabel,
          })}
        </p>
      </section>
    );
  }

  return (
    <section className="stale" role="status">
      <p className="stale__label">{t(offline ? 'stale.offline' : 'stale.saved')}</p>

      <p className="stale__statement">
        {t(offline ? 'stale.bodyOffline' : 'stale.body', { age })}
      </p>

      {/*
        The age appears twice on purpose: once in the statement, and again
        beside the issue time. An absolute time alone lets stale read as
        current; an age alone hides which bulletin it was.
      */}
      <p className="stale__provenance">
        {source} · {issuedAtLabel} · {age}
      </p>
    </section>
  );
}

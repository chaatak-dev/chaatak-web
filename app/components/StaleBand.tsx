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

import { ageLabel } from '@/lib/offline/cache';
import type { SpeechLang } from '@/lib/speech/types';

type Props = {
  lang: SpeechLang;
  ageMinutes: number;
  /** True once the cached warning's own validity window has elapsed. */
  expired: boolean;
  /** Where the cached value came from, and when it said it was issued. */
  source: string;
  issuedAtLabel: string;
  offline: boolean;
};

export function StaleBand({
  lang,
  ageMinutes,
  expired,
  source,
  issuedAtLabel,
  offline,
}: Props) {
  // One label per language. Reusing a single one put "40 मिनट पहले" into the
  // English sentence, which is exactly the kind of seam that makes a warning
  // look machine-assembled at the moment it most needs to be trusted.
  const ageHi = ageLabel(ageMinutes, 'hi');
  const ageEn = ageLabel(ageMinutes, 'en');
  const ageOwn = lang === 'hi' ? ageHi : ageEn;

  /*
   * An expired warning is NOT shown as a warning. A red bulletin that ended at
   * 16:30, surfaced offline at 19:00, reads as live danger — so past its
   * window it stops being a warning and becomes an admission that we cannot
   * say what is current.
   */
  if (expired) {
    return (
      <section className="absence absence--nodata stale stale--expired" role="status">
        <p className="absence__label">
          <span lang="hi" className="absence__label-hi">
            चेतावनी की अवधि बीत चुकी है
          </span>
          <span className="absence__label-en">Warning expired</span>
        </p>

        <p lang="hi" className="absence__statement">
          यह चेतावनी {issuedAtLabel} बजे तक की थी और अब लागू नहीं है।
          {offline ? ' आप ऑफ़लाइन हैं, इसलिए अभी की जानकारी नहीं बता सकते।' : ''}
        </p>
        <p className="absence__statement-en">
          This warning ran until {issuedAtLabel} and is no longer in force.
          {offline
            ? ' You are offline, so we cannot tell you what is current.'
            : ''}
        </p>
      </section>
    );
  }

  return (
    <section className="stale" role="status">
      <p className="stale__label">
        <span lang="hi" className="stale__label-hi">
          पुरानी जानकारी
        </span>
        <span className="stale__label-en">{offline ? 'Offline' : 'Saved'}</span>
      </p>

      <p lang="hi" className="stale__statement">
        {offline ? 'आप ऑफ़लाइन हैं। ' : ''}
        यह {ageHi} की जानकारी है।
      </p>
      <p className="stale__statement-en">
        {offline ? 'You are offline. ' : ''}
        This is from {ageEn}.
      </p>

      {/*
        The age appears twice on purpose: once in the statement, and again
        beside the issue time. An absolute time alone lets stale read as
        current; an age alone hides which bulletin it was.
      */}
      <p className="stale__provenance">
        {source} · {issuedAtLabel} · {ageOwn}
      </p>
    </section>
  );
}

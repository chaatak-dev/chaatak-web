/**
 * Turning a warning answer into something the model can read.
 *
 * Severity used to be computed for the advice check and never handed to the
 * renderer. So asked "is there a warning for Nicobar?" the model answered
 * truthfully about a DATA block that contained none, and said there were none
 * while five were in force. The severity was right; the model simply could not
 * see it.
 *
 * The three states below stay distinct, and that is the whole point:
 *
 *   inForce: [...]   IMD lists these.
 *   inForce: []      IMD was asked and lists nothing.
 *   unavailable      We do not know.
 *
 * Collapsing the last two would turn a lookup failure into an all-clear, and
 * silence about a cyclone is the dangerous direction for this system.
 *
 * WHAT GOES IN HERE IS WHAT A PERSON HEARS BACK. The model repeats this fact
 * set almost verbatim, so raw values reach the user through it: it read out
 * "codes 2, 4 and 8" and "2026-09-21T00:00:00+05:30", neither of which means
 * anything to a farmer. Hazards are named from IMD's own published code table
 * and times are rendered in IST. The machine-readable forms are untouched
 * where they are stored and used -- the Warning objects, the weather route,
 * dispatch dedup -- because this is a view for reading, not the record.
 */

import { formatIstStamp, formatIstWindow } from '../format';
import type { InterfaceLang } from '../i18n/languages';
import { readHazards } from '../weather/imd-codes';
import type { NoData, NoWarning, Warning } from '../weather/types';

export type WarningFacts =
  | {
      /** Empty means asked-and-nothing-in-force, never "we did not ask". */
      inForce: {
        severity: string;
        /** Named from IMD's published table. Never a guess at a number. */
        hazards: string[];
        /** IMD codes this build does not recognise, reported rather than lost. */
        unrecognisedCodes?: string[];
        /** "21 Sep 2026", or "21 Sep 2026 to 22 Sep 2026" across a boundary. */
        when: string;
      }[];
      source: string | null;
      issuedAt: string | null;
    }
  | { unavailable: string };

/**
 * Carries its own source and issue time.
 *
 * The readings in the same fact set may come from a different source, and one
 * provenance line cannot stand for both — a warning from IMD must not end up
 * attributed to whoever supplied the temperature.
 */
export function warningFacts(
  answer: Warning[] | NoWarning | NoData,
  lang: InterfaceLang,
): WarningFacts {
  if (Array.isArray(answer)) {
    return {
      inForce: answer.map((w) => {
        const { hazards, unrecognised } = readHazards(w.code, lang);
        return {
          severity: w.severity,
          hazards,
          ...(unrecognised.length > 0 ? { unrecognisedCodes: unrecognised } : {}),
          when: formatIstWindow(w.validFrom, w.validTo),
        };
      }),
      source: answer[0]?.provenance.source ?? null,
      issuedAt: answer[0] ? formatIstStamp(answer[0].provenance.issuedAt) : null,
    };
  }

  if (answer.kind === 'noWarning') {
    return {
      inForce: [],
      source: answer.source,
      issuedAt: answer.issuedAt ? formatIstStamp(answer.issuedAt) : null,
    };
  }

  return { unavailable: answer.statement[lang] };
}

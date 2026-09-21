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
 */

import type { InterfaceLang } from '../i18n/languages';
import type { NoData, NoWarning, Warning } from '../weather/types';

export type WarningFacts =
  | {
      /** Empty means asked-and-nothing-in-force, never "we did not ask". */
      inForce: {
        severity: string;
        code: string;
        validFrom: string;
        validTo: string;
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
      inForce: answer.map((w) => ({
        severity: w.severity,
        code: w.code,
        validFrom: w.validFrom,
        validTo: w.validTo,
      })),
      source: answer[0]?.provenance.source ?? null,
      issuedAt: answer[0]?.provenance.issuedAt ?? null,
    };
  }

  if (answer.kind === 'noWarning') {
    return { inForce: [], source: answer.source, issuedAt: answer.issuedAt };
  }

  return { unavailable: answer.statement[lang] };
}

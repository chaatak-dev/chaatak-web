/**
 * POST /api/chat
 *
 *   parse → fetch → render → VERIFY → ship
 *
 * Runs server-side so no provider key or upstream endpoint reaches the
 * browser. An answer always ships: if the model is out or the gate rejects,
 * the template goes instead and the user never learns a provider failed.
 */

import { classify } from '@/lib/chat/classify';
import { boundContext } from '@/lib/chat/context';
import { REDIRECT } from '@/lib/chat/scope';
import type { FactsSnapshot, Grounding, Message, StandingQuery } from '@/lib/chat/types';
import { logQuery } from '@/lib/log';
import { GAZETTEER } from '@/lib/parse/gazetteer';
import { patternParser } from '@/lib/parse/patterns';
import { writeReply } from '@/lib/render/reply';
import type { SpeechLang } from '@/lib/speech/types';
import { OUTLOOK_DAYS } from '@/lib/weather/api';
import { placeResolver, weatherSource } from '@/lib/weather/source';
import { conditionFor } from '@/lib/weather/wmo';
import type { DistrictId, Severity } from '@/lib/weather/types';

type ChatRequest = {
  question?: string;
  lang?: string;
  history?: Message[];
  standing?: StandingQuery | null;
};

export type ChatReply = {
  text: string;
  lang: SpeechLang;
  grounding?: Grounding;
  standing: StandingQuery | null;
  /** Diagnostics, useful in the demo and harmless to expose. */
  meta: { parseLayer: string; fromModel: boolean; gate: string; latencyMs: number };
};

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: 'malformed body' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return Response.json({ error: 'no question' }, { status: 400 });

  const lang: SpeechLang = body.lang === 'en' ? 'en' : 'hi';
  const history = Array.isArray(body.history) ? body.history : [];
  const standing = body.standing ?? null;

  /* ---- parse: patterns first, model only on a miss ---------------- */

  let parseLayer = 'pattern';
  let inScope = true;
  let needsWeather = true;
  let place = '';
  let intent = standing?.intent ?? 'current';
  let timeWindow = standing?.timeWindow ?? ({ kind: 'now' } as const);
  let variable = standing?.variable ?? ('all' as const);

  const byPattern = await patternParser.parse(question, {
    lang,
    lastPlace: standing?.place ?? undefined,
  });

  if (byPattern?.kind === 'query') {
    place = byPattern.placeWasImplied ? (standing?.place ?? '') : byPattern.place;
    intent = byPattern.intent;
    timeWindow = byPattern.timeWindow;
    variable = byPattern.variable;
  } else {
    parseLayer = 'llm';
    const classified = await classify(question, standing);
    if (classified) {
      inScope = classified.inScope;
      needsWeather = classified.needsWeather;
      place = classified.place || (standing?.place ?? '');
      intent = classified.intent;
      timeWindow = classified.timeWindow;
      variable = classified.variable;
    } else {
      // Providers all out. Treat it as conversational and let the template
      // answer rather than refusing.
      needsWeather = false;
    }
  }

  /* ---- out of scope: one friendly line, no lecture ---------------- */

  if (!inScope) {
    logQuery({
      parseLayer: 'llm',
      cacheHit: false,
      latencyMs: Date.now() - started,
      lang,
      outcome: 'cannotParse',
    });
    const reply: ChatReply = {
      text: REDIRECT[lang],
      lang,
      standing,
      meta: {
        parseLayer,
        fromModel: false,
        gate: 'skipped',
        latencyMs: Date.now() - started,
      },
    };
    return Response.json(reply, { headers: { 'cache-control': 'no-store' } });
  }

  /* ---- fetch, when the answer needs values ------------------------ */

  let facts: FactsSnapshot | null = null;
  let grounding: Grounding | undefined;
  let severity: Severity | 'unknown' = 'unknown';
  let nextStanding = standing;
  const places: string[] = [];

  if (needsWeather && place) {
    const resolved = await placeResolver().resolve(place);

    if ('kind' in resolved) {
      // Unresolvable place: an honest statement, no model call at all.
      const reply: ChatReply = {
        text: resolved.statement[lang],
        lang,
        standing,
        meta: {
          parseLayer,
          fromModel: false,
          gate: 'skipped',
          latencyMs: Date.now() - started,
        },
      };
      logQuery({
        parseLayer: parseLayer as 'pattern' | 'llm',
        cacheHit: false,
        latencyMs: Date.now() - started,
        lang,
        outcome: 'noData',
      });
      return Response.json(reply, { headers: { 'cache-control': 'no-store' } });
    }

    const source = weatherSource();
    const district = (resolved.admin2 ?? resolved.name) as DistrictId;
    const [current, outlook, warnings] = await Promise.all([
      source.getCurrent(resolved),
      source.getForecast(resolved, OUTLOOK_DAYS),
      source.getWarnings(district),
    ]);

    if (Array.isArray(warnings) && warnings.length > 0) {
      severity = warnings.reduce<Severity>(
        (worst, w) =>
          ['none', 'watch', 'alert', 'warning'].indexOf(w.severity) >
          ['none', 'watch', 'alert', 'warning'].indexOf(worst)
            ? w.severity
            : worst,
        'none',
      );
    } else if (!Array.isArray(warnings) && warnings.kind === 'noWarning') {
      severity = 'none';
    }

    const provenance =
      current.kind === 'reading'
        ? current.provenance
        : outlook.kind === 'forecast'
          ? outlook.provenance
          : null;

    // Exactly what the model is shown is exactly what the gate verifies.
    //
    // Provenance is IN here, not just on the UI line. The model naturally
    // wants to say "as of 16:15", and without the issue time in the fact set
    // a perfectly true statement is rejected as an invented number — which is
    // what happened the first time this ran.
    facts = {
      place: {
        name: resolved.name,
        district: resolved.admin2 ?? null,
        state: resolved.admin1 ?? null,
      },
      source: provenance
        ? {
            name: provenance.source,
            issuedAt: provenance.issuedAt,
            basis: provenance.timeBasis,
          }
        : null,
      current:
        current.kind === 'reading'
          ? {
              condition: conditionFor(current.conditionCode)?.[lang] ?? null,
              measurements: current.measurements,
            }
          : { unavailable: current.statement[lang] },
      outlook:
        outlook.kind === 'forecast'
          ? { days: outlook.days, units: outlook.units }
          : { unavailable: outlook.statement[lang] },
    };

    places.push(resolved.name);
    if (resolved.admin1) places.push(resolved.admin1);
    if (resolved.admin2) places.push(resolved.admin2);

    if (provenance) {
      grounding = { place: resolved, provenance, severity, facts };
    }

    nextStanding = {
      place,
      resolvedPlace: resolved,
      intent,
      timeWindow,
      variable,
      setAt: new Date().toISOString(),
    };
  } else if (standing?.place) {
    // Ungrounded turn still carries the standing place, so the gate can tell
    // a legitimate reference from an invented one.
    places.push(standing.place);
    if (standing.resolvedPlace?.name) places.push(standing.resolvedPlace.name);
    if (standing.resolvedPlace?.admin1) places.push(standing.resolvedPlace.admin1);
  }

  /* ---- render, then verify ---------------------------------------- */

  const context = boundContext(history, nextStanding, facts);

  const fallback = facts
    ? buildTemplate(facts, lang)
    : lang === 'hi'
      ? 'मैं मौसम के बारे में बता सकता हूँ। किस जगह का पूछना है?'
      : 'I can help with the weather. Which place would you like?';

  const reply = await writeReply({
    question,
    lang,
    context,
    facts,
    places,
    severity,
    gazetteer: GAZETTEER,
    fallback,
  });

  logQuery({
    parseLayer: parseLayer as 'pattern' | 'llm',
    cacheHit: false,
    provider: reply.provider,
    gate: reply.gate === 'skipped' ? undefined : (reply.gate as 'passed' | 'rejected'),
    gateReason: reply.gateReason,
    fellBackToTemplate: !reply.fromModel,
    latencyMs: Date.now() - started,
    lang,
    outcome: 'answered',
  });

  const payload: ChatReply = {
    text: reply.text,
    lang,
    grounding,
    standing: nextStanding,
    meta: {
      parseLayer,
      fromModel: reply.fromModel,
      gate: reply.gate,
      latencyMs: Date.now() - started,
    },
  };

  return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
}

/** The floor the system lands on when the model is out or the gate rejects. */
function buildTemplate(facts: FactsSnapshot, lang: SpeechLang): string {
  const current = facts.current as
    | { condition: string | null; measurements: { key: string; value: number; unit: string }[] }
    | { unavailable: string };

  if ('unavailable' in current) return current.unavailable;

  const temperature = current.measurements.find((m) => m.key === 'temperature');
  const condition = current.condition;

  if (!temperature) {
    return condition ?? (lang === 'hi' ? 'जानकारी उपलब्ध नहीं है।' : 'No data available.');
  }

  return lang === 'hi'
    ? `${condition ? condition + '। ' : ''}अभी तापमान ${temperature.value} ${temperature.unit} है।`
    : `${condition ? condition + '. ' : ''}It is ${temperature.value} ${temperature.unit} right now.`;
}

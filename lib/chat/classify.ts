/**
 * Scope and query extraction, in one model call.
 *
 * Reached only when the pattern layer misses. A clear weather question never
 * gets here — patterns answer it for free, and that is what keeps a provider
 * off the hot path.
 */

import { completeWithFallback } from '../llm/chain';
import { providers } from '../llm/index';
import type { JsonSchema } from '../llm/types';
import type { Intent, TimeWindow, Variable } from '../parse/types';
import { SCOPE_RULES } from './scope';
import type { Scope, StandingQuery } from './types';

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    inScope: { type: 'boolean' },
    needsWeather: { type: 'boolean' },
    intent: { type: 'string', enum: ['current', 'forecast', 'warning'] },
    place: { type: 'string' },
    dayOffset: { type: 'integer' },
    rangeDays: { type: 'integer' },
    variable: {
      type: 'string',
      enum: ['all', 'temperature', 'rain', 'wind', 'humidity'],
    },
  },
  required: [
    'inScope',
    'needsWeather',
    'intent',
    'place',
    'dayOffset',
    'rangeDays',
    'variable',
  ],
};

const SYSTEM = [
  SCOPE_RULES,
  '',
  'Then extract the weather query, if there is one.',
  '',
  '- `place`: copy it EXACTLY as the user wrote it. Same script, same spelling,',
  '  same case. Never transliterate or correct it. Empty string if none is',
  '  mentioned in THIS message — an earlier place is supplied separately.',
  '- `dayOffset`: 0 today, 1 tomorrow, 2 the day after. In Hindi कल means',
  '  tomorrow here and परसों the day after.',
  '- `rangeDays`: 0 unless a span was asked for, such as इस हफ़्ते.',
  '- `intent`: "warning" for warnings, alerts, or a named hazard — cyclone,',
  '  storm, flood, heatwave, चक्रवात, तूफ़ान, बाढ़, लू.',
  '- Never invent a place, a number, or a forecast.',
].join('\n');

export type Classification = Scope & {
  intent: Intent;
  /** Verbatim from this message, or '' when none was named. */
  place: string;
  timeWindow: TimeWindow;
  variable: Variable;
};

/** Unsure resolves to in scope, so a failure here does not refuse the user. */
const GENEROUS_DEFAULT: Classification = {
  inScope: true,
  needsWeather: false,
  intent: 'current',
  place: '',
  timeWindow: { kind: 'now' },
  variable: 'all',
};

export async function classify(
  question: string,
  standing: StandingQuery | null,
): Promise<Classification | null> {
  const context = standing?.place
    ? `The conversation is already about ${standing.place}.`
    : 'No place has been mentioned yet.';

  const { result } = await completeWithFallback(providers(), {
    system: SYSTEM,
    user: `${context}\n\nUser: ${question}`,
    schema: SCHEMA,
    schemaName: 'chat_turn',
    temperature: 0,
    maxTokens: 300,
  });

  // Every provider out: the caller falls back to templates.
  if (result.kind !== 'ok') return null;

  try {
    const raw = JSON.parse(result.text) as {
      inScope: boolean;
      needsWeather: boolean;
      intent: Intent;
      place: string;
      dayOffset: number;
      rangeDays: number;
      variable: Variable;
    };

    const rangeDays = Number(raw.rangeDays) || 0;
    const dayOffset = Number(raw.dayOffset) || 0;

    return {
      inScope: raw.inScope !== false,
      needsWeather: raw.needsWeather === true,
      intent: raw.intent ?? 'current',
      place: typeof raw.place === 'string' ? raw.place.trim() : '',
      timeWindow:
        rangeDays > 0
          ? { kind: 'range', days: rangeDays }
          : dayOffset === 0 && raw.intent === 'current'
            ? { kind: 'now' }
            : { kind: 'day', offset: dayOffset },
      variable: raw.variable ?? 'all',
    };
  } catch {
    return GENEROUS_DEFAULT;
  }
}

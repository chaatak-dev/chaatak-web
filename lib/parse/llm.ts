/**
 * The LLM parse layer: the exception path, reached only when patterns and the
 * cache both miss.
 *
 * Its single job is turning messy natural language into a structured query. It
 * never produces a weather value, and it never touches the place name beyond
 * copying it out.
 */

import { completeWithFallback } from '../llm/chain';
import { providers } from '../llm/index';
import type { JsonSchema } from '../llm/types';
import type { ParseContext, ParseResult, Parser, Variable } from './types';

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    understood: { type: 'boolean' },
    intent: { type: 'string', enum: ['current', 'forecast', 'warning'] },
    place: { type: 'string' },
    dayOffset: { type: 'integer' },
    rangeDays: { type: 'integer' },
    variable: {
      type: 'string',
      enum: ['all', 'temperature', 'rain', 'wind', 'humidity'],
    },
  },
  required: ['understood', 'intent', 'place', 'dayOffset', 'rangeDays', 'variable'],
};

/**
 * The verbatim-place instruction is the load-bearing line here.
 *
 * Hindi speech returns Devanagari, and Devanagari is the only form the
 * geocoder that handles it can read. A model that "helpfully" transliterated
 * गाज़ियाबाद to "Ghaziabad" would hand the resolver a string that either fails
 * or — far worse, as the transliteration trials showed — matches somewhere
 * else entirely. Extract, never normalise.
 */
const SYSTEM = [
  'You extract a weather query from a question. You never answer it.',
  '',
  'Rules:',
  '- `place`: copy the place EXACTLY as the user wrote it. Same script, same',
  '  spelling, same case. Never transliterate, never translate, never correct',
  '  spelling. If the user wrote Devanagari, return Devanagari.',
  '- If no place is mentioned, return an empty string for `place`.',
  '- `dayOffset`: 0 today, 1 tomorrow, 2 the day after. In Hindi कल means',
  '  tomorrow here and परसों means the day after.',
  '- `rangeDays`: 0 unless the user asked about a span such as इस हफ़्ते,',
  '  in which case use the number of days.',
  '- `understood`: false if this is not a weather retrieval question. Advice',
  '  questions ("should I spray my crops") are NOT weather retrieval.',
  '- `intent`: use "warning" for any question about warnings, alerts, or a',
  '  named hazard — cyclone, storm, flood, heatwave, चक्रवात, तूफ़ान, बाढ़, लू.',
  '  A cyclone question is a warning question, not a wind forecast.',
  '- Never invent a place, a number, or a forecast.',
].join('\n');

type Extracted = {
  understood: boolean;
  intent: 'current' | 'forecast' | 'warning';
  place: string;
  dayOffset: number;
  rangeDays: number;
  variable: Variable;
};

const NOT_UNDERSTOOD = {
  hi: 'यह समझ नहीं आया। सिर्फ़ जगह का नाम बोलें या लिखें।',
  en: 'That was not understood. Say or type just the place name.',
};

const NO_PLACE = {
  hi: 'किस जगह के लिए? जगह का नाम बोलें या लिखें।',
  en: 'Which place? Say or type a place name.',
};

export const llmParser: Parser = {
  name: 'llm',

  async parse(text: string, ctx: ParseContext): Promise<ParseResult | null> {
    const { result } = await completeWithFallback(providers(), {
      system: SYSTEM,
      user: text,
      schema: SCHEMA,
      schemaName: 'weather_query',
      temperature: 0,
      maxTokens: 300,
    });

    // Every provider out. The caller falls back to templates; the user never
    // learns a rate limit happened.
    if (result.kind !== 'ok') return null;

    let extracted: Extracted;
    try {
      extracted = JSON.parse(result.text) as Extracted;
    } catch {
      return null;
    }

    if (!extracted.understood) {
      return {
        kind: 'cannotParse',
        reason: 'notUnderstood',
        statement: NOT_UNDERSTOOD,
        servedBy: 'llm',
      };
    }

    const spoken = typeof extracted.place === 'string' ? extracted.place.trim() : '';
    const place = spoken || ctx.lastPlace || null;
    if (!place) {
      return {
        kind: 'cannotParse',
        reason: 'noPlace',
        statement: NO_PLACE,
        servedBy: 'llm',
      };
    }

    const rangeDays = Number(extracted.rangeDays) || 0;
    const dayOffset = Number(extracted.dayOffset) || 0;

    return {
      kind: 'query',
      intent: extracted.intent,
      place,
      placeWasImplied: spoken === '',
      timeWindow:
        rangeDays > 0
          ? { kind: 'range', days: rangeDays }
          : dayOffset === 0 && extracted.intent === 'current'
            ? { kind: 'now' }
            : { kind: 'day', offset: dayOffset },
      variable: extracted.variable ?? 'all',
      servedBy: 'llm',
    };
  },
};

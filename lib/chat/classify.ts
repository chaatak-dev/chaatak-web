/**
 * Reading a turn with a model — the exception path.
 *
 * Reached only when `understandLocally` cannot read a turn. A clear weather
 * question, a follow-up, a correction, "thanks" and "ohh really" never get
 * here; patterns answer them for free, and that is what keeps a provider off
 * the hot path.
 *
 * The model is given the conversation, because a turn only means something in
 * one: "and before that?" is nothing on its own. It returns a structured
 * reading — never an answer, never a value.
 *
 * THE PLACE IS CHECKED, NOT TRUSTED. The model is told to copy a place
 * verbatim, and then it is held to that in code: a place that is not a slice
 * of what the person actually wrote is dropped. A model that "helpfully"
 * transliterated गाज़ियाबाद to Ghaziabad, or supplied a place the person never
 * said, loses the place rather than passing it to the resolver.
 */

import { cached, TTL } from '../cache';
import { completeWithFallback } from '../llm/chain';
import { providers } from '../llm/index';
import type { JsonSchema } from '../llm/types';
import type { TimeWindow, Variable } from '../parse/types';
import { SCOPE_RULES } from './scope';
import type { SocialKind } from './social';
import { intentFor, type Plan, type PlaceRef, type TurnContext } from './understand';

const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    act: { type: 'string', enum: ['weather', 'social', 'about', 'outOfScope'] },
    social: {
      type: 'string',
      enum: ['', 'greeting', 'thanks', 'farewell', 'acknowledgement', 'reaction', 'smallTalk'],
    },
    place: { type: 'string' },
    placeIsHere: { type: 'boolean' },
    usesContext: { type: 'boolean' },
    topic: { type: 'string', enum: ['', 'current', 'forecast', 'warning', 'history'] },
    dayOffset: { type: 'integer' },
    pastDays: { type: 'integer' },
    pastHours: { type: 'integer' },
    date: { type: 'string' },
    lastRain: { type: 'boolean' },
    beforePrevious: { type: 'boolean' },
    variable: { type: 'string', enum: ['', 'all', 'temperature', 'rain', 'wind', 'humidity'] },
  },
  required: [
    'act', 'social', 'place', 'placeIsHere', 'usesContext', 'topic', 'dayOffset',
    'pastDays', 'pastHours', 'date', 'lastRain', 'beforePrevious', 'variable',
  ],
};

const SYSTEM = [
  SCOPE_RULES,
  '',
  'Classify the NEW message in the conversation. Never answer it.',
  '',
  '- `act`: "weather" for anything that needs weather values (a forecast, a',
  '  follow-up, advice that depends on conditions, a place given on its own);',
  '  "social" for greetings, thanks, reactions ("oh really", "wow"), "ok" and',
  '  small talk; "about" for explanations of weather terms or questions about',
  '  Chaatak; "outOfScope" only for clearly unrelated requests.',
  '- `place`: copy it EXACTLY as written in the NEW message — same script,',
  '  spelling and case. Never transliterate, correct or translate it. Empty',
  '  if the new message names no place. Never copy a place from the context.',
  '- `placeIsHere`: true if the person means where they are ("near me").',
  '- `usesContext`: true if the message continues the previous question',
  '  ("and tomorrow?", "what about wind?", "and before that?").',
  '- `topic`: "history" for the PAST (what already happened: yesterday, last',
  '  week, when it last rained); "forecast" for future days; "current" for',
  '  now or today; "warning" for warnings, alerts or named hazards.',
  '- `dayOffset`: whole days from today. 1 tomorrow, -1 yesterday. In Hindi',
  '  कल is YESTERDAY with a past-tense verb (हुई थी, था) and TOMORROW otherwise.',
  '- `pastDays` / `pastHours`: for "last N days" / "last N hours", else 0.',
  '- `date`: YYYY-MM-DD if a calendar date was named, else "".',
  '- `lastRain`: true for "when did it last rain" and its variants.',
  '- `beforePrevious`: true for "and before that?".',
  '- `variable`: what was asked about, or "" if the message names nothing.',
  '- Never invent a place, a number, or a forecast.',
].join('\n');

type Raw = {
  act: 'weather' | 'social' | 'about' | 'outOfScope';
  social: '' | SocialKind;
  place: string;
  placeIsHere: boolean;
  usesContext: boolean;
  topic: '' | 'current' | 'forecast' | 'warning' | 'history';
  dayOffset: number;
  pastDays: number;
  pastHours: number;
  date: string;
  lastRain: boolean;
  beforePrevious: boolean;
  variable: '' | Variable;
};

/** Enough of the conversation for the model to read a follow-up, and no more. */
export type Conversation = { lastUser?: string; lastAssistant?: string };

function contextLines(ctx: TurnContext, conversation: Conversation): string {
  const s = ctx.standing;
  const lines = [`Today is ${ctx.today} (India).`];
  if (s?.place) {
    lines.push(
      `The conversation is about ${s.place}: ${s.intent}, ${describeWindow(s.timeWindow)}, ${s.variable}.`,
    );
  } else if (s?.pending) {
    lines.push('The previous question is waiting for a place.');
  } else {
    lines.push('No place has been discussed yet.');
  }
  if (conversation.lastUser) lines.push(`Previous user message: ${clip(conversation.lastUser)}`);
  if (conversation.lastAssistant) lines.push(`Previous reply: ${clip(conversation.lastAssistant)}`);
  return lines.join('\n');
}

function clip(text: string): string {
  return text.length > 220 ? `${text.slice(0, 220)}…` : text;
}

function describeWindow(window: TimeWindow): string {
  switch (window.kind) {
    case 'now':
      return 'now';
    case 'day':
      return window.offset === 0 ? 'today' : `${window.offset > 0 ? '+' : ''}${window.offset} days`;
    case 'range':
      return `next ${window.days} days`;
    case 'past':
      return `last ${window.days} days`;
    case 'pastHours':
      return `last ${window.hours} hours`;
    case 'date':
      return window.date;
    case 'lastEvent':
      return 'the last rain';
  }
}

/**
 * The verbatim rule, enforced. Case and surrounding whitespace aside, the
 * place must appear in the message exactly as the model returned it.
 */
export function verbatimPlace(message: string, place: string): string | null {
  const wanted = place.trim();
  if (!wanted) return null;
  const at = message.toLowerCase().indexOf(wanted.toLowerCase());
  if (at === -1) return null;
  // Return the person's own spelling and case, not the model's.
  return message.slice(at, at + wanted.length);
}

/** The model's reading, as a plan, with every field checked. */
export function toPlan(raw: Raw, message: string, ctx: TurnContext): Plan {
  switch (raw.act) {
    case 'social': {
      const kind = raw.social || 'acknowledgement';
      return { act: 'social', kind };
    }
    case 'about':
      return { act: 'about' };
    case 'outOfScope':
      return { act: 'outOfScope' };
  }

  const named = verbatimPlace(message, raw.place ?? '');
  const standing = ctx.standing;
  const hasPlace = Boolean(standing?.place);

  let window: TimeWindow | null = null;
  const pastHours = Number(raw.pastHours) || 0;
  const pastDays = Number(raw.pastDays) || 0;
  const dayOffset = Number(raw.dayOffset) || 0;

  if (raw.beforePrevious && standing) {
    const current = standing.pending?.timeWindow ?? standing.timeWindow;
    if (current.kind === 'lastEvent') window = { kind: 'lastEvent', before: standing.event?.start };
    else if (current.kind === 'day') window = { kind: 'day', offset: current.offset - 1 };
  }
  if (!window && raw.lastRain) window = { kind: 'lastEvent' };
  if (!window && pastHours > 0) window = { kind: 'pastHours', hours: Math.min(pastHours, 72) };
  if (!window && pastDays > 0) window = { kind: 'past', days: Math.min(pastDays, 31) };
  if (!window && /^\d{4}-\d{2}-\d{2}$/.test(raw.date ?? '')) window = { kind: 'date', date: raw.date };
  if (!window && dayOffset !== 0) window = { kind: 'day', offset: Math.max(-3650, Math.min(15, dayOffset)) };
  if (!window && raw.topic === 'history') window = { kind: 'day', offset: -1 };

  const inherit = raw.usesContext && standing;
  const fromWindow = standing?.pending?.timeWindow ?? standing?.timeWindow;
  const finalWindow: TimeWindow = window ?? (inherit && fromWindow ? fromWindow : { kind: 'now' });

  const fromVariable = standing?.pending?.variable ?? standing?.variable;
  const variable: Variable = raw.variable || (inherit && fromVariable ? fromVariable : 'all');

  const place: PlaceRef = named
    ? { kind: 'named', text: named }
    : raw.placeIsHere
      ? { kind: 'here' }
      : hasPlace
        ? { kind: 'carried' }
        : { kind: 'none' };

  return {
    act: 'weather',
    turn: raw.usesContext ? 'followup' : named && !raw.variable && raw.topic === '' ? 'place' : 'query',
    place,
    intent: intentFor(finalWindow, {
      warning: raw.topic === 'warning',
      past: raw.topic === 'history',
      today: ctx.today,
    }),
    window: finalWindow,
    variable,
  };
}

/** Normalised for the cache key: case and spacing do not change a reading. */
function cacheKey(message: string, ctx: TurnContext): string {
  const s = ctx.standing;
  // The context's SHAPE, never its contents: whether there is a place, what
  // the topic is. The reading depends on those; it must not depend on — or
  // carry between people — whose place it was.
  const shape = [
    s?.place ? 'p' : '-',
    s?.pending ? 'w' : '-',
    s?.intent ?? '-',
    s ? describeWindow(s.timeWindow) : '-',
    s?.variable ?? '-',
    ctx.today,
  ].join('|');
  return `classify:${shape}:${message.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * The model's reading of a turn, or null when every provider is out — in
 * which case the caller asks what was meant. It never geocodes on a miss.
 */
export async function classify(
  message: string,
  ctx: TurnContext,
  conversation: Conversation = {},
): Promise<{ plan: Plan; cacheHit: boolean } | null> {
  let fromCache = true;

  const raw = await cached<Raw | null>(
    cacheKey(message, ctx),
    TTL.parse,
    async () => {
      fromCache = false;
      const { result } = await completeWithFallback(providers(), {
        system: SYSTEM,
        user: `${contextLines(ctx, conversation)}\n\nNEW message: ${message}`,
        schema: SCHEMA,
        schemaName: 'chat_turn',
        temperature: 0,
        // The JSON is small; the rest is room for a reasoning fallback to
        // think in without being cut off (see lib/render/reply.ts).
        maxTokens: 800,
        // Understanding the turn comes before fetching and rendering it, so
        // its budget is the smaller one.
        timeoutMs: 6_000,
        deadlineMs: 8_000,
      });
      if (result.kind !== 'ok') return null;
      try {
        return JSON.parse(result.text) as Raw;
      } catch {
        return null;
      }
    },
    // An outage is not a reading, and must not be remembered as one.
    (value) => value !== null,
  );

  if (!raw) return null;
  return { plan: toPlan(raw, message, ctx), cacheHit: fromCache };
}

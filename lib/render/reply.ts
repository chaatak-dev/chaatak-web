/**
 * Writing the assistant's turn.
 *
 * The model is free here: opinions, advice, follow-ups, explanation. The one
 * thing it may not do is originate a weather value, and that is enforced by
 * the gate afterwards rather than by asking nicely in this prompt.
 *
 * Every return path ends in a template when the model is unavailable or the
 * gate rejects, so an answer always ships.
 */

import { completeWithFallback } from '../llm/chain';
import { providers } from '../llm/index';
import { logGateRejection } from '../log';
import { verifyReply } from './chat-gate';
import type { ChatContext, FactsSnapshot } from '../chat/types';
import type { AnswerStyle } from '../i18n/detect';
import type { SpeechLang } from '../speech/types';
import type { Severity } from '../weather/types';

export type ReplyRequest = {
  question: string;
  lang: SpeechLang;
  /** Which language and script to write in, decided before generation. */
  answer: AnswerStyle;
  context: ChatContext;
  facts: FactsSnapshot | null;
  places: string[];
  severity: Severity | 'unknown';
  severityStrings?: string[];
  gazetteer?: Set<string>;
  /**
   * What this turn is, in a line or two for the model: what was asked, and
   * how it relates to the conversation. Decided by the conversation layer;
   * the model is told, not asked to work it out.
   */
  turn?: string[];
  /** Shipped when the model is out or the gate rejects. */
  fallback: string;
};

export type ReplyResult = {
  text: string;
  /** False when the template shipped instead of the model's words. */
  fromModel: boolean;
  provider?: string;
  gate: 'passed' | 'rejected' | 'skipped';
  gateReason?: string;
  latencyMs: number;
};

function systemPrompt(req: ReplyRequest): string {
  const lines = [
    'You are Chaatak, a weather assistant for rural India.',
    '',
    'Answer like a normal assistant. Opinions, advice, recommendations and',
    'follow-up questions are all welcome and expected. Be warm and brief.',
    '',
    // Named outright rather than left to "mirror the user", which drifted:
    // Bengali and Punjabi questions came back in Hindi, English ones in
    // Hinglish. The gate checks the script afterwards regardless.
    `LANGUAGE. ${req.answer.instruction}`,
    'Match their register: casual in, casual out. Never switch script on the',
    'user. You may understand Haryanvi, Bhojpuri, Awadhi and Rajasthani input,',
    'but reply in standard Hindi or English. Do not fake a dialect.',
    '',
    'THE ONE RULE: never state a weather number that was not given to you in',
    'DATA below. Not an estimate, not a rounding, not a typical value. If you',
    'were given no data, give no numbers — describe and advise instead.',
    'Write numbers as digits exactly as they appear in DATA, never in words.',
    // Durations are the common way a stray numeral gets in. "next 24 hours"
    // is not a weather claim, but 24 is not in DATA either, and the gate
    // rejects the whole reply over it.
    'This includes durations and counts: do not write "next 24 hours" or',
    '"3-day forecast" unless that number is in DATA. Say "tomorrow" or',
    '"later today" instead. Use "daysAgo" and "hoursAgo" from DATA for',
    '"3 days ago"; never work out a date difference yourself.',
    '',
    'ANSWER THE QUESTION ASKED. DATA.asked says what it was about and when.',
    'A question about the past is answered from DATA.history only — never',
    'from a present reading or a forecast. If DATA says something is',
    'unavailable, say so plainly; never estimate it.',
    'History values are MODELLED (see DATA.historyNature), not rain-gauge',
    'readings. Say that briefly, once.',
  ];

  if (req.turn?.length) lines.push('', 'THIS TURN:', ...req.turn.map((t) => `- ${t}`));

  if (!req.facts) {
    lines.push(
      '',
      'Nothing was fetched for this turn. Reply briefly and naturally, and',
      'state no weather value at all — not even one from earlier in the',
      'conversation.',
    );
  }

  if (req.severityStrings?.length) {
    lines.push(
      '',
      'A WARNING IS IN FORCE. Your reply MUST begin with this exact text:',
      `  ${req.severityStrings[0]}`,
      'Do not reword it. Do not soften it. After it, never suggest that',
      'conditions are fine or that the activity is safe.',
    );
  }

  lines.push('', 'Keep it to two or three sentences.');
  return lines.join('\n');
}

function userPrompt(req: ReplyRequest): string {
  const parts: string[] = [];

  if (req.context.standing?.place) {
    const s = req.context.standing;
    parts.push(
      `CONTEXT: the conversation is about ${s.place}` +
        `${s.variable !== 'all' ? `, specifically ${s.variable}` : ''}.`,
    );
  }

  for (const turn of req.context.history) {
    parts.push(`${turn.role === 'user' ? 'User' : 'You'}: ${turn.text}`);
  }

  parts.push(
    req.facts
      ? `DATA (the only numbers you may use):\n${JSON.stringify(req.facts)}`
      : 'DATA: none was fetched for this turn. Use no numbers.',
  );
  parts.push(`User: ${req.question}`);
  return parts.join('\n\n');
}

export async function writeReply(req: ReplyRequest): Promise<ReplyResult> {
  const started = Date.now();

  const { result } = await completeWithFallback(providers(), {
    system: systemPrompt(req),
    user: userPrompt(req),
    temperature: 0.4,
    // Room to think as well as to answer. The fallback is a reasoning model,
    // and its thinking is spent from this same budget: at 400 it used up to
    // 398 tokens reasoning and was cut off before — or during — the answer.
    // A cut-off completion is now refused by the adapter, so a budget this
    // size is what keeps the fallback useful rather than just safe.
    maxTokens: 1000,
    // Eight seconds for any one provider, twelve for the lot: a hung primary
    // still leaves the fallback time to answer, and nobody waits longer than
    // that for words when the template is already written.
    timeoutMs: 8_000,
    deadlineMs: 12_000,
  });

  if (result.kind !== 'ok') {
    // Every provider out. The user gets the template and never learns why.
    return {
      text: req.fallback,
      fromModel: false,
      gate: 'skipped',
      latencyMs: Date.now() - started,
    };
  }

  const text = result.text.trim();
  const verdict = verifyReply(text, {
    facts: req.facts,
    places: req.places,
    severity: req.severity,
    severityStrings: req.severityStrings,
    gazetteer: req.gazetteer,
    expectScript: req.answer.script,
  });

  if (!verdict.ok) {
    // Kept with the text, so an over-strict gate can be told apart from a
    // model actually misbehaving.
    logGateRejection({
      reason: verdict.reason,
      detail: verdict.detail,
      rejectedText: text,
      grounded: req.facts !== null,
      severity: req.severity,
      lang: req.lang,
    });

    return {
      text: req.fallback,
      fromModel: false,
      provider: result.provider,
      gate: 'rejected',
      gateReason: verdict.reason,
      latencyMs: Date.now() - started,
    };
  }

  return {
    text,
    fromModel: true,
    provider: result.provider,
    gate: 'passed',
    latencyMs: Date.now() - started,
  };
}

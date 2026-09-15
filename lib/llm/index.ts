/**
 * Provider order — the one config value.
 *
 * Default order is set by what actually works on our keys today, verified by
 * calling each one rather than by reading docs:
 *
 *   groq/qwen3.8-27b    ~190ms, schema-valid, keeps Devanagari verbatim
 *   groq/gpt-oss-120b   ~1000ms, schema-valid on ordinary queries but returns
 *                       json_validate_failed on out-of-scope questions, so it
 *                       is a fallback rather than the primary
 *   gemini              project currently denied access (403); adapter ready
 *   sarvam              no key yet; present, unselectable
 *
 * Both Groq entries share an account, so a Groq-wide outage takes out the
 * whole chain. That is survivable by design: the LLM is the exception path,
 * the pattern layer serves the common queries without it, and a failed render
 * ships the template response. No weather value depends on a model.
 *
 * Override with LLM_PROVIDERS, e.g. "gemini,groq-primary,groq-fallback".
 */

import { geminiModel } from './gemini';
import { groqModel } from './groq';
import { sarvamModel } from './sarvam';
import type { LanguageModel } from './types';

const GROQ_PRIMARY = process.env.GROQ_MODEL ?? 'qwen/qwen3.8-27b';
const GROQ_FALLBACK = process.env.GROQ_FALLBACK_MODEL ?? 'openai/gpt-oss-120b';

function build(name: string): LanguageModel | null {
  switch (name) {
    case 'groq-primary':
      return groqModel(GROQ_PRIMARY, 'groq-primary');
    case 'groq-fallback':
      return groqModel(GROQ_FALLBACK, 'groq-fallback');
    case 'gemini':
      return geminiModel();
    case 'sarvam':
      return sarvamModel();
    default:
      return null;
  }
}

const DEFAULT_ORDER = ['groq-primary', 'groq-fallback', 'gemini', 'sarvam'];

export function providers(): LanguageModel[] {
  const order = (process.env.LLM_PROVIDERS ?? DEFAULT_ORDER.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return order
    .map(build)
    .filter((p): p is LanguageModel => p !== null);
}

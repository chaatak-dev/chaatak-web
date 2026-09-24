/**
 * Google Gemini, via the Generative Language API.
 *
 * STATUS: configured but currently unreachable on our key. `gemini-2.5-flash`
 * is retired for new API users, and every newer Flash model answers 403
 * "Your project has been denied access" — a project-level block, not a model
 * or key problem. Verified through Node fetch under production conditions.
 *
 * The adapter is complete and correct, so when that block is lifted this
 * becomes primary again by moving it up the list in `index.ts`. Until then the
 * chain skips past it on the 403, costing one fast round trip; set
 * `GEMINI_ENABLED=false` to skip even that.
 *
 * Gemini's native responseSchema is the reason it was chosen: it returns
 * schema-valid JSON rather than JSON-shaped text.
 */

import type {
  CompletionRequest,
  CompletionResult,
  LanguageModel,
} from './types';

const BASE_URL =
  process.env.GEMINI_BASE_URL ??
  'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 12_000;

export function geminiModel(
  model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
): LanguageModel {
  const label = 'gemini';

  return {
    name: label,
    model,

    configured() {
      if (process.env.GEMINI_ENABLED === 'false') return false;
      return Boolean(process.env.GEMINI_API_KEY);
    },

    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const key = process.env.GEMINI_API_KEY;
      if (!key) {
        return { kind: 'unavailable', provider: label, reason: 'no GEMINI_API_KEY' };
      }

      const generationConfig: Record<string, unknown> = {
        temperature: request.temperature ?? 0,
        maxOutputTokens: request.maxTokens ?? 500,
      };
      if (request.schema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = request.schema;
      }

      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(
          `${BASE_URL}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: request.system }] },
              contents: [{ role: 'user', parts: [{ text: request.user }] }],
              generationConfig,
            }),
            signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            cache: 'no-store',
          },
        );
      } catch (error) {
        return {
          kind: 'failed',
          provider: label,
          reason: error instanceof Error ? error.name : 'network error',
        };
      }

      if (res.status === 429) return { kind: 'rateLimited', provider: label };
      // 403 is the project-level denial above; 404 is a retired model. Both
      // mean "this provider cannot serve", so the chain moves on.
      if ([401, 403, 404].includes(res.status)) {
        return { kind: 'unavailable', provider: label, reason: `HTTP ${res.status}` };
      }
      if (!res.ok) {
        return { kind: 'failed', provider: label, reason: `HTTP ${res.status}` };
      }

      try {
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        };
        const candidate = json.candidates?.[0];
        const text = candidate?.content?.parts?.[0]?.text;
        if (typeof text !== 'string' || !text.trim()) {
          return { kind: 'failed', provider: label, reason: 'empty completion' };
        }
        // Anything but a natural stop — the token limit, a safety stop —
        // leaves text that ends where it was cut, not where it was finished.
        if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
          return { kind: 'failed', provider: label, reason: `stopped: ${candidate.finishReason}` };
        }
        return {
          kind: 'ok',
          text,
          provider: label,
          model,
          latencyMs: Date.now() - started,
        };
      } catch {
        return { kind: 'failed', provider: label, reason: 'unparseable response' };
      }
    },
  };
}

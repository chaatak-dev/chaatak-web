/**
 * The language-model interface.
 *
 * Same shape as WeatherSource, PlaceResolver and SpeechSource: one interface,
 * several implementations, the order chosen by config, every key server-side.
 *
 * A provider failure is a RESULT, never an exception. Rate limits in
 * particular are a normal operating condition on free tiers, and one must
 * never reach a user — the chain moves to the next provider, and if every
 * provider is out the caller ships the template response. The read path does
 * not depend on any of this: weather values come from an adapter, and a model
 * being unavailable costs conversational phrasing, not data.
 */

export type JsonSchema = Record<string, unknown>;

export type CompletionRequest = {
  system: string;
  user: string;
  /** Structured-output schema. Providers that support it enforce it. */
  schema?: JsonSchema;
  schemaName?: string;
  maxTokens?: number;
  temperature?: number;
  /** Abort budget. A slow provider must not hold the request open. */
  timeoutMs?: number;
};

export type CompletionResult =
  | {
      kind: 'ok';
      text: string;
      provider: string;
      model: string;
      latencyMs: number;
    }
  /** Try the next provider. Never surfaced to a user. */
  | { kind: 'rateLimited'; provider: string; retryAfterMs?: number }
  /** No key, disabled, or the account cannot reach this model. */
  | { kind: 'unavailable'; provider: string; reason: string }
  /** Reached it, and it did not give usable output. */
  | { kind: 'failed'; provider: string; reason: string };

export interface LanguageModel {
  name: string;
  /** The model id actually called, for logging. */
  model: string;
  /** False when no key is configured. Checked before any network call. */
  configured(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

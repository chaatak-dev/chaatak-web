/**
 * Whether accounts are switched on, and what they need to be.
 *
 * Accounts are OPTIONAL CONFIGURATION, deliberately. Chaatak's job is to speak
 * a warning to someone who asked for one, and none of that needs a login. So a
 * deployment with no Supabase keys serves weather exactly as it did before:
 * the sign-in control is absent rather than broken, guests keep their
 * conversation in the browser, and the account routes answer with a stated
 * reason instead of a stack trace.
 *
 * That is not a convenience for development. It is what keeps a missing
 * environment variable from taking the forecast down with it.
 *
 * `NEXT_PUBLIC_` on both values is correct and not an oversight. The project
 * URL and the anon key are published to the browser by design — the anon key
 * carries no authority of its own, it only identifies the project, and every
 * row it can reach is decided by row-level security against a verified JWT.
 * The service-role key is the one that carries authority, and it appears
 * nowhere in this codebase: server routes reach Postgres through DATABASE_URL
 * instead.
 */

/**
 * Written out in full rather than read from a variable name.
 *
 * Next inlines `process.env.NEXT_PUBLIC_X` into the client bundle by static
 * analysis. `process.env[name]` is not static, is not inlined, and arrives in
 * the browser as undefined — which would look exactly like "accounts are
 * switched off" on a deployment where they are switched on.
 */
const URL_VALUE = process.env.NEXT_PUBLIC_SUPABASE_URL;

/**
 * Supabase renamed this key; both names are accepted so a project created
 * under either naming works without anyone having to know which era it came
 * from. `sb_publishable_…` is the current form, `eyJ…` the older JWT form.
 */
const KEY_VALUE =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export type AuthConfig = { url: string; anonKey: string };

/** True when this deployment can sign people in. */
export function authConfigured(): boolean {
  return Boolean(URL_VALUE && KEY_VALUE);
}

/**
 * The configuration, or null when accounts are off.
 *
 * Returns null rather than throwing, because "off" is a supported state that
 * every caller has a sensible answer for.
 */
export function authConfig(): AuthConfig | null {
  if (!URL_VALUE || !KEY_VALUE) return null;
  return { url: URL_VALUE, anonKey: KEY_VALUE };
}

/**
 * What to tell someone when they reach for an account feature that is not
 * configured. Names the variables and no values — the same rule the rest of
 * the configuration errors follow.
 */
export const AUTH_UNCONFIGURED =
  'Accounts are not configured on this deployment. Set ' +
  'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable ' +
  'sign-in, chat history and monitored locations. Weather queries do not ' +
  'need them.';

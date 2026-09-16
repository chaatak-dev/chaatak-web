/**
 * An error that means "this deployment is configured wrong", as distinct from
 * "something went wrong while handling this request".
 *
 * The distinction earns its keep on the client. A guard that throws usefully
 * on the server became "Could not reach the server. Check your connection" in
 * the browser, which sent an operator to look at their wifi while the actual
 * fault was an environment variable. The type is what lets the route say which
 * kind of failure it was instead of collapsing both into one message.
 */
export class ConfigurationError extends Error {
  readonly kind = 'configuration' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError;
}

/**
 * Whether a configuration message may be shown to whoever made the request.
 *
 * In production it may not. A visitor can act on "the server answered with an
 * error and it is not your connection"; they cannot act on the name of an
 * environment variable, and handing config surface to anyone probing the site
 * is information disclosure. This deployment named something harmless; the
 * next one might not. The full text is still logged server-side either way.
 *
 * Keyed on VERCEL_ENV rather than NODE_ENV, deliberately: NODE_ENV is
 * "production" for PREVIEW builds too, so gating on it alone would hide the
 * detail exactly where it is most wanted. NODE_ENV is the fallback for
 * environments that are not Vercel.
 */
export function mayRevealConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv !== 'production';
  return env.NODE_ENV !== 'production';
}

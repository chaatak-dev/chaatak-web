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

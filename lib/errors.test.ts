import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ConfigurationError, isConfigurationError, mayRevealConfiguration } from './errors';

/**
 * Who gets to see a configuration message.
 *
 * A visitor can act on "the server answered with an error and it is not your
 * connection". They cannot act on the name of an environment variable, and
 * handing config surface to anyone probing the site is information
 * disclosure — this deployment named something harmless, the next might not.
 *
 * The full text is logged server-side regardless, so gating the response never
 * costs the operator the diagnosis.
 */

const env = (values: Record<string, string | undefined>) =>
  values as NodeJS.ProcessEnv;

test('a configuration error is distinguishable from any other error', () => {
  assert.equal(isConfigurationError(new ConfigurationError('bad env')), true);
  assert.equal(isConfigurationError(new Error('bad env')), false);
  assert.equal(isConfigurationError('bad env'), false);
  assert.equal(isConfigurationError(null), false);
});

test('production withholds the detail', () => {
  assert.equal(mayRevealConfiguration(env({ VERCEL_ENV: 'production' })), false);
});

test('preview keeps the detail', () => {
  /*
   * The correction that matters here: NODE_ENV is "production" for PREVIEW
   * builds too, so gating on NODE_ENV alone would have hidden the detail
   * exactly where it is most wanted — on a preview deployment being debugged.
   * VERCEL_ENV is the variable that actually separates the two.
   */
  assert.equal(
    mayRevealConfiguration(env({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })),
    true,
  );
});

test('vercel development keeps the detail', () => {
  assert.equal(mayRevealConfiguration(env({ VERCEL_ENV: 'development' })), true);
});

test('off Vercel, NODE_ENV decides', () => {
  assert.equal(mayRevealConfiguration(env({ NODE_ENV: 'development' })), true);
  assert.equal(mayRevealConfiguration(env({ NODE_ENV: 'production' })), false);
});

test('an unset environment is treated as not production', () => {
  // A local run with nothing set is a developer at a terminal, not a visitor.
  assert.equal(mayRevealConfiguration(env({})), true);
});

test('VERCEL_ENV wins over NODE_ENV', () => {
  // Both are set on every Vercel deployment; only one of them separates
  // production from preview.
  assert.equal(
    mayRevealConfiguration(env({ VERCEL_ENV: 'production', NODE_ENV: 'development' })),
    false,
  );
});

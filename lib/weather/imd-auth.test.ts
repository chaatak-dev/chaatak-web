import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __setImdTokenForTests, forgetImdToken, imdCredentials, imdToken } from './imd-auth';

const CREDENTIALS = { email: 'a@b.test', password: 'secret', apiKey: 'key-123' };

/** Swap global fetch for the duration of one test, counting the calls. */
async function withFetch<T>(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  body: (calls: () => number) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    count++;
    return handler(String(url), init);
  }) as typeof globalThis.fetch;
  try {
    return await body(() => count);
  } finally {
    globalThis.fetch = original;
    __setImdTokenForTests(null);
  }
}

function tokenResponse(token: string, expiresIn: number | undefined = 3600): Response {
  return new Response(
    JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: expiresIn }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/* ---- configuration ---------------------------------------------------- */

test('missing credentials are named, not reported as an upstream failure', () => {
  const saved = { ...process.env };
  try {
    delete process.env.IMD_EMAIL;
    delete process.env.IMD_PASSWORD;
    process.env.IMD_API_KEY = 'key';
    // A generic "IMD is unreachable" would send someone to IMD's status page
    // when the actual fix is two environment variables.
    assert.throws(() => imdCredentials(), /IMD_EMAIL/);
    assert.throws(() => imdCredentials(), /IMD_PASSWORD/);
  } finally {
    Object.assign(process.env, saved);
  }
});

/* ---- caching ---------------------------------------------------------- */

test('a cached token is reused instead of signing in again', async () => {
  __setImdTokenForTests(null);
  await withFetch(
    () => tokenResponse('tok-1'),
    async (calls) => {
      assert.equal(await imdToken(CREDENTIALS), 'tok-1');
      assert.equal(await imdToken(CREDENTIALS), 'tok-1');
      assert.equal(await imdToken(CREDENTIALS), 'tok-1');
      assert.equal(calls(), 1, 'signed in more than once for one valid token');
    },
  );
});

test('an expired token is replaced', async () => {
  await withFetch(
    () => tokenResponse('tok-fresh'),
    async (calls) => {
      // Cached, but already past its expiry.
      __setImdTokenForTests('tok-stale', Date.now() - 1000);
      assert.equal(await imdToken(CREDENTIALS), 'tok-fresh');
      assert.equal(calls(), 1);
    },
  );
});

test('forgetting a token forces the next call to sign in', async () => {
  await withFetch(
    () => tokenResponse('tok-2'),
    async (calls) => {
      __setImdTokenForTests('tok-1', Date.now() + 60_000);
      assert.equal(await imdToken(CREDENTIALS), 'tok-1');
      assert.equal(calls(), 0);

      // A token can be revoked before its stated expiry; being refused is the
      // only way to find out.
      forgetImdToken();
      assert.equal(await imdToken(CREDENTIALS), 'tok-2');
      assert.equal(calls(), 1);
    },
  );
});

/* ---- the refresh race ------------------------------------------------- */

test('concurrent callers on a cold instance share ONE sign-in', async () => {
  __setImdTokenForTests(null);
  await withFetch(
    async () => {
      // A real sign-in is not instant, which is exactly the window in which a
      // naive implementation fires a second, third and fourth one.
      await new Promise((r) => setTimeout(r, 25));
      return tokenResponse('tok-shared');
    },
    async (calls) => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () => imdToken(CREDENTIALS)),
      );
      assert.deepEqual(new Set(results), new Set(['tok-shared']));
      assert.equal(calls(), 1, `signed in ${calls()} times for one burst`);
    },
  );
});

test('a failed sign-in does not wedge every later call', async () => {
  __setImdTokenForTests(null);
  let attempt = 0;
  await withFetch(
    () => {
      attempt++;
      if (attempt === 1) return new Response('nope', { status: 500 });
      return tokenResponse('tok-after-failure');
    },
    async () => {
      // The in-flight promise must be cleared on rejection too, or one bad
      // minute would poison the instance until it was recycled.
      await assert.rejects(() => imdToken(CREDENTIALS), /HTTP 500/);
      assert.equal(await imdToken(CREDENTIALS), 'tok-after-failure');
    },
  );
});

/* ---- what the response is trusted for --------------------------------- */

test('a response with no access_token is a failure, not an empty token', async () => {
  __setImdTokenForTests(null);
  await withFetch(
    () => new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 200 }),
    async () => {
      await assert.rejects(() => imdToken(CREDENTIALS), /no access_token/);
    },
  );
});

test('an absurd or missing lifetime does not produce an eternal token', async () => {
  for (const expiresIn of [undefined, 0, -1, 999_999_999]) {
    __setImdTokenForTests(null);
    await withFetch(
      () => tokenResponse('tok', expiresIn as number | undefined),
      async () => {
        const before = Date.now();
        await imdToken(CREDENTIALS);
        // Falls back to the documented hour; the exact value matters less than
        // that it is bounded and in the future.
        const second = await imdToken(CREDENTIALS);
        assert.equal(second, 'tok');
        assert.ok(Date.now() - before < 60_000);
      },
    );
  }
});

test('the sign-in never puts the password in the error it throws', async () => {
  __setImdTokenForTests(null);
  await withFetch(
    () => new Response(JSON.stringify({ echo: CREDENTIALS.password }), { status: 403 }),
    async () => {
      // A failed sign-in body can echo what was sent, and an error message
      // ends up in logs.
      await assert.rejects(
        () => imdToken(CREDENTIALS),
        (error: Error) => {
          assert.ok(!error.message.includes(CREDENTIALS.password), error.message);
          assert.match(error.message, /HTTP 403/);
          return true;
        },
      );
    },
  );
});

test('the password is sent as JSON in the body, never in the URL', async () => {
  __setImdTokenForTests(null);
  await withFetch(
    (url, init) => {
      assert.ok(!url.includes(CREDENTIALS.password), 'password appeared in the URL');
      assert.ok(!url.includes(CREDENTIALS.email), 'email appeared in the URL');
      const body = JSON.parse(String(init.body));
      assert.equal(body.email, CREDENTIALS.email);
      assert.equal(body.password, CREDENTIALS.password);
      assert.equal(init.method, 'POST');
      return tokenResponse('tok');
    },
    async () => {
      assert.equal(await imdToken(CREDENTIALS), 'tok');
    },
  );
});

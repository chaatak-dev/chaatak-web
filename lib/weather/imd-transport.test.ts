import { test } from 'node:test';
import assert from 'node:assert/strict';

import { imdEndpoint, imdFetch, imdRoute } from './imd-transport';

function withEnv<T>(env: Record<string, string | undefined>, body: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('with no gateway configured, requests go straight to IMD', () => {
  withEnv({ IMD_GATEWAY_URL: undefined, IMD_GATEWAY_TOKEN: undefined }, () => {
    const route = imdRoute();
    assert.equal(route.kind, 'direct');
    assert.equal(route.origin, 'https://api.imd.gov.in');
  });
});

test('a gateway needs both its URL and its secret to count as configured', () => {
  // A URL without a secret would reach a forwarder that refuses every
  // request: a slower and more confusing failure than not being configured.
  withEnv({ IMD_GATEWAY_URL: 'https://gw.test', IMD_GATEWAY_TOKEN: undefined }, () => {
    assert.equal(imdRoute().kind, 'direct');
  });
  withEnv({ IMD_GATEWAY_URL: undefined, IMD_GATEWAY_TOKEN: 'secret' }, () => {
    assert.equal(imdRoute().kind, 'direct');
  });
  withEnv({ IMD_GATEWAY_URL: 'https://gw.test/', IMD_GATEWAY_TOKEN: 'secret' }, () => {
    const route = imdRoute();
    assert.equal(route.kind, 'gateway');
    // Trailing slash trimmed, so paths do not end up doubled.
    assert.equal(route.origin, 'https://gw.test');
  });
});

test('the gateway is addressed under /imd and carries the shared secret', async () => {
  const original = globalThis.fetch;
  let seenUrl = '';
  let seenHeaders: Record<string, string> = {};
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    seenUrl = String(url);
    seenHeaders = (init.headers ?? {}) as Record<string, string>;
    return new Response('{}', { status: 200 });
  }) as typeof globalThis.fetch;

  try {
    await withEnv(
      { IMD_GATEWAY_URL: 'https://gw.test', IMD_GATEWAY_TOKEN: 'shhh' },
      async () => {
        await imdFetch('api/v1/districtwarning?id=573', { headers: { 'x-api-key': 'k' } });
      },
    );
    assert.equal(seenUrl, 'https://gw.test/imd/api/v1/districtwarning?id=573');
    assert.equal(seenHeaders['x-gateway-token'], 'shhh');
    // The IMD headers still travel; the gateway adds nothing and removes nothing.
    assert.equal(seenHeaders['x-api-key'], 'k');
  } finally {
    globalThis.fetch = original;
  }
});

test('without a gateway the same call goes to IMD, with no gateway header', async () => {
  const original = globalThis.fetch;
  let seenUrl = '';
  let seenHeaders: Record<string, string> = {};
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    seenUrl = String(url);
    seenHeaders = (init.headers ?? {}) as Record<string, string>;
    return new Response('{}', { status: 200 });
  }) as typeof globalThis.fetch;

  try {
    await withEnv(
      { IMD_GATEWAY_URL: undefined, IMD_GATEWAY_TOKEN: undefined },
      async () => {
        await imdFetch('/api/v1/districtwarning?id=573', {});
      },
    );
    assert.equal(seenUrl, 'https://api.imd.gov.in/api/v1/districtwarning?id=573');
    assert.equal(seenHeaders['x-gateway-token'], undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('provenance names IMD s endpoint, not the host we happened to reach', () => {
  // A reader of a provenance line cares which bulletin this came from, not
  // which piece of our infrastructure relayed it.
  assert.equal(imdEndpoint('api/v1/districtwarning'), '/api/v1/districtwarning');
  assert.equal(imdEndpoint('/api/v1/districtwarning'), '/api/v1/districtwarning');
});

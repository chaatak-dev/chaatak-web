/**
 * How a request reaches IMD.
 *
 * Two ways, chosen by one config value:
 *
 *   direct   — straight to api.imd.gov.in. What runs locally.
 *   gateway  — through a small forwarder on a host with a fixed IP.
 *
 * The gateway exists for one reason: Vercel functions call out from a large,
 * changing pool of addresses, so an API that allowlists callers by IP cannot
 * be reached from them. A forwarder on an EC2 instance with an Elastic IP has
 * one address that stays put, and that address is what gets allowlisted.
 *
 * It is TRANSPORT ONLY. It forwards a path and headers and returns the
 * response untouched. It holds no credentials, parses no weather, knows no
 * district, and makes no decision about severity. Every piece of that stays in
 * Chaatak, because a second place that understands warnings is a second place
 * that can get them wrong — and one that is far harder to test.
 *
 * The sign-in call goes through it too. An API that allowlists data requests
 * has every reason to allowlist the call that issues the token as well, and
 * discovering otherwise in production is not worth the saved hop.
 */

const IMD_ORIGIN = 'https://api.imd.gov.in';

export type ImdRoute =
  | { kind: 'direct'; origin: string }
  | { kind: 'gateway'; origin: string; token: string };

/**
 * Where IMD requests are sent.
 *
 * Absent gateway config, direct. Both gateway variables are required together:
 * a gateway URL without its shared secret would reach a forwarder that refuses
 * every request, which is a slower and more confusing failure than not being
 * configured at all.
 */
export function imdRoute(): ImdRoute {
  const url = process.env.IMD_GATEWAY_URL?.trim();
  const token = process.env.IMD_GATEWAY_TOKEN?.trim();

  if (url && token) {
    return { kind: 'gateway', origin: url.replace(/\/+$/, ''), token };
  }
  return { kind: 'direct', origin: IMD_ORIGIN };
}

/**
 * Perform one IMD request by its path, for example
 * `api/v1/districtwarning?id=573`.
 *
 * Returns the raw Response so callers decide what a non-2xx means. The
 * adapter treats a 401 differently from a 500, and flattening that here would
 * take the distinction away from the only code that can use it.
 */
export async function imdFetch(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs = 15_000,
): Promise<Response> {
  const route = imdRoute();
  const clean = path.replace(/^\/+/, '');

  const url =
    route.kind === 'gateway'
      ? `${route.origin}/imd/${clean}`
      : `${route.origin}/${clean}`;

  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (route.kind === 'gateway') {
    // The forwarder refuses anything without this, so an open relay is not
    // left sitting on a public address.
    headers['x-gateway-token'] = route.token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timer);
  }
}

/** For provenance: the endpoint as IMD sees it, not as we happened to reach it. */
export function imdEndpoint(path: string): string {
  return `/${path.replace(/^\/+/, '')}`;
}

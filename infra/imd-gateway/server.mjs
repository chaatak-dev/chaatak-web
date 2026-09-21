/**
 * The IMD gateway. A forwarder, and nothing else.
 *
 * WHY IT EXISTS
 *
 * Vercel functions call out from a large, changing pool of addresses. An API
 * that allowlists callers by IP cannot be reached from them. This runs on an
 * EC2 instance with an Elastic IP, so there is one address that stays put, and
 * that address is what IMD allowlists.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It holds no credentials. It does not sign in. It does not know what a
 * district is, what a warning is, or what any colour means. It reads no field
 * of any response and makes no decision about severity.
 *
 * Every one of those stays in Chaatak, because a second place that understands
 * warnings is a second place that can get them wrong, and it would be the one
 * place without the tests. The whole contract is: take a path, add nothing,
 * forward it, hand the answer back unchanged.
 *
 * SECURITY
 *
 * A bare forwarder on a public address is an open relay. Every request must
 * carry the shared secret in x-gateway-token, and only paths under the IMD
 * origin are reachable — a caller cannot use this to reach anything else.
 *
 * RUN
 *
 *   GATEWAY_TOKEN=<shared secret> node server.mjs
 *
 * Environment:
 *   GATEWAY_TOKEN  required. Must match Chaatak's IMD_GATEWAY_TOKEN.
 *   PORT           default 8080.
 */

import { createServer } from 'node:http';

const IMD_ORIGIN = 'https://api.imd.gov.in';
const PORT = Number(process.env.PORT ?? 8080);
const TOKEN = process.env.GATEWAY_TOKEN;

if (!TOKEN) {
  process.stderr.write('GATEWAY_TOKEN is required. Refusing to start an open relay.\n');
  process.exit(1);
}

/** Headers forwarded upstream. Everything else is dropped. */
const PASS_THROUGH = new Set(['authorization', 'x-api-key', 'content-type', 'accept']);

/** Constant-time-ish comparison, so the secret cannot be guessed byte by byte. */
function secretMatches(given) {
  if (typeof given !== 'string' || given.length !== TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) diff |= TOKEN.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // A forwarder has no reason to accept anything large.
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  try {
    // Health is unauthenticated on purpose: a load balancer or a person
    // checking the box is up learns nothing from it.
    if (req.url === '/health') return send(200, JSON.stringify({ ok: true }));

    if (!secretMatches(req.headers['x-gateway-token'])) {
      return send(401, JSON.stringify({ error: 'unauthorised' }));
    }

    const match = /^\/imd\/(.*)$/s.exec(req.url ?? '');
    if (!match) return send(404, JSON.stringify({ error: 'not found' }));

    // Resolved against the IMD origin, so "../" or an absolute URL cannot
    // point this anywhere else.
    const target = new URL(match[1], `${IMD_ORIGIN}/`);
    if (target.origin !== IMD_ORIGIN) {
      return send(400, JSON.stringify({ error: 'origin not allowed' }));
    }

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (PASS_THROUGH.has(key.toLowerCase()) && typeof value === 'string') {
        headers[key] = value;
      }
    }

    const method = req.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);

    const upstream = await fetch(target, { method, headers, body });
    const text = await upstream.text();

    // Status and body, unchanged. Chaatak decides what a 401 or a 500 means.
    res.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    });
    res.end(text);

    // Path and status only. Never a header, never a body: one carries the
    // bearer token and the other can echo the credentials that were sent.
    process.stdout.write(`${new Date().toISOString()} ${method} ${target.pathname} -> ${upstream.status}\n`);
  } catch (error) {
    process.stderr.write(`gateway error: ${error.message}\n`);
    send(502, JSON.stringify({ error: 'upstream failed' }));
  }
});

server.listen(PORT, () => {
  process.stdout.write(`IMD gateway listening on ${PORT}, forwarding to ${IMD_ORIGIN}\n`);
});

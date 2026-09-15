/**
 * POST /api/alerts/subscribe
 *
 * Registers an anonymous subscriber. Saved districts live in localStorage for
 * the user's own view, but the subscription must also exist server-side: a
 * scheduled job cannot read localStorage, and the push endpoint and its keys
 * have to be somewhere the daemon can reach.
 *
 * No auth and no account — the id is generated and means nothing beyond "this
 * browser asked to be told".
 */

import { randomUUID } from 'node:crypto';
import { alertStore } from '@/lib/alerts/store';
import type { Channel, Subscriber, SubscriberId } from '@/lib/alerts/types';
import type { DistrictId } from '@/lib/weather/types';

export const dynamic = 'force-dynamic';

function readChannels(input: unknown): Channel[] {
  if (!Array.isArray(input)) return [];
  const out: Channel[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;

    if (
      c.kind === 'webpush' &&
      typeof c.endpoint === 'string' &&
      typeof c.p256dh === 'string' &&
      typeof c.auth === 'string'
    ) {
      out.push({
        kind: 'webpush',
        endpoint: c.endpoint,
        p256dh: c.p256dh,
        auth: c.auth,
      });
    } else if (c.kind === 'telegram' && typeof c.chatId === 'string') {
      out.push({ kind: 'telegram', chatId: c.chatId });
    }
  }
  return out;
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'malformed body' }, { status: 400 });
  }

  const districts = Array.isArray(body.districts)
    ? (body.districts.filter((d) => typeof d === 'string' && d) as DistrictId[])
    : [];
  if (districts.length === 0) {
    return Response.json({ error: 'no districts' }, { status: 400 });
  }

  const channels = readChannels(body.channels);
  if (channels.length === 0) {
    return Response.json({ error: 'no usable channel' }, { status: 400 });
  }

  const subscriber: Subscriber = {
    id: (typeof body.id === 'string' && body.id
      ? body.id
      : randomUUID()) as SubscriberId,
    districts,
    lang: body.lang === 'en' ? 'en' : 'hi',
    channels,
    createdAt: new Date().toISOString(),
  };

  const store = alertStore();
  await store.migrate();
  await store.upsertSubscriber(subscriber);

  // The id goes back so the browser can keep using it and update rather than
  // creating a second subscription each time the user changes districts.
  return Response.json(
    { id: subscriber.id, districts: subscriber.districts, lang: subscriber.lang },
    { headers: { 'cache-control': 'no-store' } },
  );
}

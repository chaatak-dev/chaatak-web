/**
 * Display formatting.
 *
 * Nothing here changes a value. Numbers are rendered exactly as upstream sent
 * them — no rounding, no unit conversion, no locale digit substitution — so
 * what is on screen is what the source said. These helpers only decide how a
 * timestamp or a date reads.
 */

/** Everything shows in the place's own timezone, not the reader's. */
function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * Zone labels Intl gets wrong for our readers.
 *
 * `timeZoneName: 'short'` renders Asia/Kolkata as "GMT+5:30" — an offset, not
 * a name, and not what anyone in India calls the time. The zones we serve are
 * named here; everywhere else falls back to whatever offset Intl gives.
 */
const ZONE_LABELS: Record<string, string> = {
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
};

function zoneLabel(timeZone: string, at: Date): string {
  const named = ZONE_LABELS[timeZone];
  if (named) return named;

  const part = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'short',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');

  return part?.value ?? '';
}

/** Today's calendar date in a given zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(timeZone) }).format(
    new Date(),
  );
}

/**
 * A timestamp for the provenance line: "01:15 GMT+5:30".
 *
 * The date is added whenever the stamp is not from today in that zone, so a
 * value that has gone stale says so instead of looking current.
 */
export function formatStamp(iso: string, timeZone: string): string {
  const zone = safeZone(timeZone);
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const stampDay = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(date);
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const time = `${clock} ${zoneLabel(zone, date)}`.trim();

  if (stampDay === todayIn(zone)) return time;

  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
  }).format(date);
  return `${day}, ${time}`;
}

export type DayLabel = { hi: string; en: string; date: string };

/**
 * A row label for the outlook: "आज / Today", "कल / Tomorrow", then weekdays.
 * Weekday and month names come from CLDR — calendar facts, not weather words.
 */
export function formatDayLabel(isoDate: string, timeZone: string): DayLabel {
  const asUtc = new Date(`${isoDate}T00:00:00Z`);
  const shortDate = Number.isNaN(asUtc.getTime())
    ? isoDate
    : new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
      }).format(asUtc);

  const zone = safeZone(timeZone);
  const today = todayIn(zone);
  const tomorrow = new Date(new Date(`${today}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);

  if (isoDate === today) return { hi: 'आज', en: 'Today', date: shortDate };
  if (isoDate === tomorrow) return { hi: 'कल', en: 'Tomorrow', date: shortDate };

  return {
    hi: new Intl.DateTimeFormat('hi-IN', { timeZone: 'UTC', weekday: 'long' }).format(
      asUtc,
    ),
    en: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' }).format(
      asUtc,
    ),
    date: shortDate,
  };
}

/** The place line in the header: "Ghaziabad, Uttar Pradesh". */
export function placeLine(parts: {
  name: string;
  admin1?: string;
  country: string;
}): string {
  const region =
    parts.admin1 && parts.admin1 !== parts.name ? parts.admin1 : parts.country;
  return region ? `${parts.name}, ${region}` : parts.name;
}

/* ------------------------------------------------------------------ */
/* IMD timestamps, read by people                                      */
/* ------------------------------------------------------------------ */

/**
 * India Meteorological Department publishes on Indian Standard Time, and
 * every IMD timestamp in this system is stored as a machine-readable instant.
 * These render that instant for a reader without changing it.
 *
 * The stored value stays ISO 8601 everywhere it is stored. Only the surface
 * changes: a bulletin time read out as "2026-09-21T09:14:06.000Z" tells a
 * farmer nothing, and is five and a half hours away from what their clock
 * says.
 */
const IST = 'Asia/Kolkata';

/** "21 Sep 2026" — a calendar date in IST. */
export function formatIstDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(at);
}

/** "21 Sep 2026, 14:44 IST" — a full stamp in IST, zone named. */
export function formatIstStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const date = formatIstDate(iso);
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  return `${date}, ${clock} IST`;
}

/**
 * "21 Sep 2026" for a window inside one day, "21 Sep 2026 to 22 Sep 2026"
 * across two.
 *
 * IMD district warnings run midnight to midnight IST, so the common case is
 * one day and repeating the date twice reads as noise.
 */
export function formatIstWindow(fromIso: string, toIso: string): string {
  const from = formatIstDate(fromIso);
  const to = formatIstDate(toIso);
  return from === to ? from : `${from} to ${to}`;
}

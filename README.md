# Chaatak

Voice-first early warning for rural India. Speaks the India Meteorological
Department's official forecasts and warnings in the user's own language,
before they ask.

Smart India Hackathon 2026 · Problem Statement 26068 (IMD, Ministry of Earth
Sciences) · Team Overcast.

The architecture, the design constraints and the one rule this system is built
around are in [`CLAUDE.md`](./CLAUDE.md). This file covers running it.

---

## Running locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 91 tests, no network or database needed
```

`.env.local` holds every key and is gitignored. Nothing in it ever reaches the
browser — all third-party calls go through API routes.

| Variable | For |
| --- | --- |
| `GROQ_API_KEY` | LLM parse and render (primary provider) |
| `GEMINI_API_KEY` | LLM fallback, currently blocked at the project level |
| `BHASHINI_UDYAT_KEY` | ULCA pipeline config |
| `BHASHINI_INFERENCE_KEY` | Dhruva ASR and TTS |
| `DATABASE_URL` | Supabase Postgres, **transaction pooler on 6543** |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push |
| `TELEGRAM_BOT_TOKEN` | Telegram dispatch |
| `CRON_SECRET` | Guards the alert daemon endpoint |
| `WEATHER_SOURCE` | `open-meteo` (default) or `fixture` |

The pooler port is deliberate: Vercel opens a connection per invocation, and a
direct connection would exhaust the limit.

## Database

```bash
node scripts/migrate.mjs        # apply migrations/, then list what exists
node scripts/alerts-status.mjs  # subscribers, claims, dispatch log, seen set
```

Every statement in the migration is `IF NOT EXISTS`, so it is safe to run
repeatedly and safe to race — the cron endpoint calls it on every invocation.

---

## The alert daemon

`POST /api/cron/warnings`, authenticated with `Authorization: Bearer $CRON_SECRET`.

It polls district warnings independently of user activity, decides what is
new, and dispatches. Running it twice sends nothing the second time:
deduplication is an atomic claim in Postgres on `(subscriberId, dispatchKey)`,
not a single-runner assumption.

```bash
curl -X POST http://localhost:3000/api/cron/warnings \
     -H "authorization: Bearer $CRON_SECRET"
```

### Scheduling: GitHub Actions, not Vercel Cron

**Vercel Cron on the Hobby plan runs once a day, which is not a warning
system.** Until the project moves to Pro,
[`.github/workflows/poll-warnings.yml`](./.github/workflows/poll-warnings.yml)
is the scheduler: it POSTs to the endpoint every ten minutes, and can be fired
by hand from the Actions tab for a demo.

**Moving to Vercel Pro is a config change, not a rewrite.** The daemon is an
authenticated HTTP endpoint and knows nothing about who calls it.
[`vercel.ts`](./vercel.ts) already declares the cron at `*/5 * * * *`; on Pro
it starts working, and this workflow can simply be deleted. Vercel Cron sends
the same `Authorization: Bearer $CRON_SECRET` header automatically.

**Required repository secret:**

| Where | Name | Value |
| --- | --- | --- |
| Settings → Secrets and variables → Actions → **Secrets** | `CRON_SECRET` | the same value as `CRON_SECRET` in the deployed environment |

Optionally set the repository **variable** `CHAATAK_BASE_URL` to point the
workflow at a preview deployment; it defaults to `https://chaatak.com`.

Two limits of GitHub's scheduler worth knowing: cron runs are best-effort and
can be delayed under load, and **scheduled workflows are disabled automatically
after 60 days without repository activity**. Neither matters for a hackathon
window; both matter if this runs unattended.

The workflow fails loudly on any non-2xx, and prints the response body into
the job summary. A scheduler that dies quietly is worse than no scheduler —
the dashboard stays green while nobody is being warned about anything.

---

## Data sources

Open-Meteo is the development source while IMD access is pending; it has no
warning product, so the alert pipeline is exercised against a synthetic fixture
source (`WEATHER_SOURCE=fixture`, scenarios in `lib/weather/fixture.ts`).
IMD swaps in behind the same `WeatherSource` interface with no change above the
adapter layer.

Place resolution is routed by script rather than by language: Open-Meteo's
geocoder returns nothing at all for Devanagari, so Devanagari queries go to
Nominatim and Latin queries stay on Open-Meteo. Transliterating first was tried
and rejected — it fails wrongly rather than loudly.

## Verification gate

Every model-written reply is checked programmatically before it ships: each
numeral must appear in the fetched data, values may not be spelled out in
words, severity strings must survive verbatim, and advice may never contradict
an active warning. A rejected render is discarded and the template response
ships instead, logged with the rejected text and the rule that caught it.

Advice is free; values are verified.

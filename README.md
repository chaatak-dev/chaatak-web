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
npm test        # 421 tests, no network or database needed
```

`.env.local` holds every key and is gitignored. Every third-party call goes
through an API route, and no secret reaches the browser.

The two `NEXT_PUBLIC_` values are the exception that proves it: they are
published deliberately. A project URL and an anon key identify the Supabase
project and carry no authority of their own — every row the anon key can reach
is decided by row-level security against a verified JWT. The `service_role`
key, which does carry authority, appears nowhere in this codebase.

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
| `WEATHER_SOURCE` | what visitors see. Real sources only — `open-meteo` |
| `WARNING_SOURCE` | what the alert daemon polls. May be `fixture` |
| `NEXT_PUBLIC_SUPABASE_URL` | Accounts. Optional — without it, sign-in is absent and everything else works |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Accounts. Published to the browser by design; see below |

The pooler port is deliberate: Vercel opens a connection per invocation, and a
direct connection would exhaust the limit.

## Database

```bash
npm run migrate            # apply migrations/, then list tables and RLS state
npm run verify:rls         # prove one account cannot reach another's data
npm run verify:accounts    # run every account flow against the real store
node scripts/alerts-status.mjs  # subscribers, claims, dispatch log, seen set
```

Every statement in every migration is `IF NOT EXISTS` or guarded by a
catalogue lookup, so they are safe to run repeatedly and safe to race — the
cron endpoint calls the alert migration on every invocation. `*.down.sql`
files are skipped; a reversal is run by hand.

Both verification scripts create throwaway accounts and delete them again,
including when an assertion fails. `verify:accounts` calls the same functions
the API routes call rather than re-implementing them in SQL, which is how it
caught a statement that bound one parameter as both `text` and `uuid` and
would have thrown the first time anyone switched alerts on.

---

## Accounts

Google sign-in through Supabase Auth, with chat history and up to three
monitored locations per account. **Set-up is two values in two dashboards and
is written out step by step in [`docs/accounts-setup.md`](./docs/accounts-setup.md).**

**Accounts are optional configuration.** Without the two `NEXT_PUBLIC_`
variables, Chaatak serves weather exactly as it did before: the sign-in
control is absent rather than broken, a guest's conversation lives in the tab,
and the account routes answer with a stated reason. A missing environment
variable cannot take the forecast down with it.

**Identity is never taken from the browser.** Every account route begins with
`getUser()`, which sends the session token to Supabase Auth and gets back the
user it actually belongs to. `getSession()` — which decodes the cookie without
checking a signature — is not wired up anywhere, because the two calls look
interchangeable and are not.

**Two independent defences, neither relying on the other.** Server routes
connect as `postgres` and scope every statement by that verified user id. Row
level security says the same thing in the database, and is what stands between
two accounts on Supabase's public PostgREST endpoint — which the browser can
reach with the anon key. `npm run verify:rls` becomes the `authenticated` role,
asserts a user id the way a verified JWT would, and tries to read and write
another account's rows.

Row-level security was also switched **on** for the Phase 4 alert tables,
which had none. They predate the browser holding any Supabase key at all;
once it holds one, `subscribers` — live Web Push endpoints and their
encryption keys — would otherwise have been readable by anyone who opened
devtools.

**Three monitored locations, enforced by the schema.** `slot` is restricted to
1–3 and unique per user, so two requests arriving together cannot both become
the third location. A count read before an insert would have looked identical
and been wrong in exactly the case worth getting right. Identity is the
DISTRICT, because a district is the unit IMD issues a warning for — two
villages in Barabanki produce identical alerts, so watching both would spend a
slot on nothing.

**The alert pipeline is unchanged.** It still polls the districts in
`subscribers.districts` and dispatches to the channels in
`subscribers.channels`. An account simply uses its own user id as the
subscriber id, so one person is one subscriber however many devices they sign
in on, and deduplication on `(subscriberId, dispatchKey)` keeps meaning one
alert per person per warning. Districts are written only while a channel
exists: a saved place with notifications off is a place to look at, not a
place to be woken by, and polling it would claim a dispatch, find nothing to
send, and burn an attempt out of the retry budget of a warning nobody could
receive.

### Permissions are asked for separately, and late

Location and notifications are independent decisions and the interface keeps
them that way.

**Location** is requested at the one moment a question cannot be answered
without it — "temperature" with no place named, and no place carried over from
the conversation. Not on page load, not on a question that named a place, not
when someone opens the locations panel. A refusal is remembered: the browser
will not prompt again after a denial, so asking again would present a button
that silently does nothing. The offer becomes "Use my location" beside a text
box instead.

**Notifications** are requested only when someone presses the control that
says what it will do. Saving a place does not reach it, and neither does
granting location. If notifications are blocked, saved places still work.

A coordinate is resolved to a canonical place through the existing gazetteer —
not a second geocoder — and then discarded. What gets stored for a place saved
from "use my location" is the town's coordinate, never the device's fix.

---

## Language

Three preferences, and they do not move each other:

| | `auto` means | Stored |
| --- | --- | --- |
| **Interface** | the device's ordered `navigator.languages` | profile · localStorage |
| **Assistant** | mirror whatever language and script the question was in | profile · localStorage |
| **Voice** | follow the assistant if set, otherwise the interface | profile · localStorage |

`UI = English, Assistant = Hindi, Voice = Hindi` is a valid configuration, and
so is every other combination. An explicit choice is never overridden by a
device change; picking **Auto** again hands control back to the device.

**Automatic detection follows `support.interface` in `lib/i18n/languages.ts`,
not a separate list.** A language becomes auto-detectable in the same commit
that gives it interface strings — Hindi and English today. The other five can
still be chosen: speech works in all seven, so the answer and the voice come
in the chosen language while the chrome borrows Hindi or English, and the
settings panel says so.

Every interface string is in `lib/i18n/strings.ts`, written by hand in both
languages. Nothing there is machine-translated and nothing there may be — the
warning taxonomy lives under the same rule next door, and a catalogue that
accepts machine output for "just the chrome" is one edit from accepting it for
a severity.

---

## The interface

Three columns on a desktop: conversations on the left, the conversation in the
middle, **the weather on the right**. The settings that used to hold a
permanent rail are behind one control in the account menu, which is where they
belonged — a person configures Chaatak once and asks it things daily, and the
permanent rail was spending the best column on the rarer job. There is one
settings surface, not two.

**The weather rail follows the conversation and adopts its snapshot.** It
shows the same values the answer was written from rather than fetching its
own: two surfaces that fetch independently eventually disagree by a degree
because they landed in different cache windows, and a reader cannot tell which
one to believe. With no conversation location and no granted permission the
rail shows an empty state and an offer. It never guesses a city.

**The transcript scrolls in one container, and the rules about it are tested.**
`lib/chat/scroll.ts` holds them as pure functions: follow the tail only while
the reader is already near it, preserve the reading position when older
messages are prepended above, and offer a jump control when the reader is not
at the bottom. The container is a `min-height: 0` flex column with
`overflow-anchor: none`, not a scrolling page under an absolutely positioned
composer — the previous arrangement needed padding to match a height it could
not know, and the transcript ran underneath the composer whenever that guess
was wrong.

### The map

MapLibre GL over [OpenFreeMap](https://openfreemap.org) vector tiles. The
base-map provider is abstracted in `lib/map/layers.ts` so it can be swapped
without touching a weather layer, and a test asserts that no layer names a
provider. Attribution is rendered, not optional.

Eight layers — temperature, precipitation, wind, cloud, air quality, UV,
pressure and alerts. Each carries its own colour scale, and the legend and the
canvas read it through the same function so they cannot disagree about what a
number looks like. The ramps are monotonic: a rainbow scale makes a small
difference look larger than a big one, which is how heatwaves get misread.

Sampling is bounded, and it is bounded on a **fixed world lattice**. Upstream
weights a batched request by the number of coordinates in it, so the cap is
the request's price: at 144 points a handful of map interactions spent the
whole free-tier minute and the map started answering 429 in production. The
cap is 96 now — country zoom asks for 64 points, a district 42 — and because
the samples sit at world positions rather than at screen ones, panning inside
one lattice cell returns the identical grid and is served from cache for
nothing. Twelve small pans across a district cost four upstream calls instead
of twelve, and the field stops shimmering as it slides.

The spacing is chosen from the viewport's **size**, never from the snapped
extent, so it cannot change while you drag. And a failed request is never
cached: a failure is not data, and remembering one told every reader for the
rest of the TTL that a layer had no source when its source had merely been
busy.

**The alerts layer draws districts, never invented polygons.** IMD publishes a
hazard code per district id and no geometry of any kind. A drawn boundary
would be one we made up, and a boundary that is nearly right tells somebody on
the wrong side of it that they are safe.

### Air quality

`AirQualitySource` is an interface with one implementation today: Open-Meteo's
CAMS model, reported on the **European** AQI breakpoints. It is labelled as
modelled and labelled as European in the interface, not in a comment, and
`station` is `null` and says so.

India's official index is CPCB's, on different breakpoints and from physical
monitoring stations. A model-derived European number presented as "AQI" is
read by anyone who knows the Indian scale as something it is not. When a CPCB
station feed is wired in behind the same interface it will carry a station and
stop being an approximation; until then the number says exactly what it is.

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
authenticated HTTP endpoint and knows nothing about who calls it. Add a `crons`
entry to [`vercel.ts`](./vercel.ts) pointing at `/api/cron/warnings` and delete
this workflow; Vercel Cron sends the same `Authorization: Bearer $CRON_SECRET`
header automatically.

**Do not add that entry back while the project is on Hobby.** A cron more
frequent than daily does not warn — it fails the deployment. That is what kept
production three commits behind on the Phase 3 build while `/api/cron/warnings`
returned 404 and the rest of the site served perfectly.

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

**IMD is the authority on what is dangerous. Open-Meteo says what is happening
this hour.** That split is the data's, not a preference. IMD's synoptic
stations report on a three-hourly cycle and the endpoint serves the last row
whenever it is asked, so at six in the evening it returns the twelve o'clock
observation — correctly, and with an honest timestamp — and Chaatak rendered
it under a sentence beginning "अभी", right now. Every individual part of that
was true and the whole of it was not.

So `WEATHER_SOURCE=imd` means district warnings from IMD and current
conditions and the forecast from Open-Meteo, each under its own name. The
station transport is kept and exported as `stationObservation`, for a caller
that wants an observation **as** an observation with its age attached, rather
than as a stand-in for the present.

Open-Meteo has no warning product, so the alert pipeline is exercised against
a synthetic fixture source. Either source swaps behind the same
`WeatherSource` interface with no change above the adapter layer.

**Two selectors, deliberately.** `WEATHER_SOURCE` drives everything a visitor
can see and **refuses synthetic sources outright**; `WARNING_SOURCE` drives the
alert daemon alone and may be a fixture. They were one variable until
production ran with `WEATHER_SOURCE=fixture`, which meant chaatak.com was
prepared to show real people a warning invented to test a pipeline. The guard
keys on the source's own `synthetic` flag rather than its name, so renaming a
fixture cannot slip it through, and it throws rather than falling back — a
silent fallback would hide the misconfiguration it exists to catch.

For the alert demo:

```
WEATHER_SOURCE=open-meteo     # visitors get real data
WARNING_SOURCE=fixture        # the daemon polls the fixture
FIXTURE_SCENARIO=orange       # an orange warning, valid six hours
```

Scenarios live in `lib/weather/fixture.ts`: `quiet`, `orange`, `red`,
`withdrawn`, `expired`.

Place resolution is routed by script rather than by language: Open-Meteo's
geocoder returns nothing at all for Devanagari, so Devanagari queries go to
Nominatim and Latin queries stay on Open-Meteo. Transliterating first was tried
and rejected — it fails wrongly rather than loudly.

### A value carries what kind of value it is

Provenance now states `nature` — `observation`, `model` or `bulletin` — and
carries `observedAt` beside `issuedAt`. `lib/weather/freshness.ts` ages a value
from `observedAt ?? issuedAt` and **never from the time the HTTP response came
back**: fetch time is a property of the network, and using it would make a
six-hour-old reading look a second old. Thresholds differ by nature, because a
three-hour-old model run is ordinary and a three-hour-old observation is not,
and an unknown nature is held to the strictest of them. A value past the stale
threshold says so in words, with its age.

The provenance line reads `Open-Meteo · model · Updated 05:15 IST`. `endpoint`
is still carried for traceability and is no longer rendered — an API path told
the farmer nothing and told everyone else our URL structure.

## Failure reporting

Three failures, told apart and worded apart: `offline`, `unreachable` (the
request left and nothing came back), and `serverError` (the server answered, so
the connection is fine). The last one says so explicitly, because reporting a
503 as "check your connection" once sent an operator to look at their wifi
while the fault was an environment variable.

A `ConfigurationError` is returned as **503** with `kind: "configuration"`. Its
message names an environment variable and never a value, and it is **withheld
in production** — a visitor can act on "not your connection", not on config
surface. It is kept in preview and development, and logged at full detail
server-side in every environment, so a production fault is still findable in
the platform logs.

Gated on `VERCEL_ENV`, not `NODE_ENV`: the latter is `production` for preview
builds too, so gating on it alone would hide the detail exactly where it is
most wanted.

## Verification gate

Every model-written reply is checked programmatically before it ships: each
numeral must appear in the fetched data, values may not be spelled out in
words, severity strings must survive verbatim, and advice may never contradict
an active warning. A rejected render is discarded and the template response
ships instead, logged with the rejected text and the rule that caught it.

Advice is free; values are verified.

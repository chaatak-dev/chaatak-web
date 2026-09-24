# Chaatak

Voice-first early warning for rural India. Speaks the India Meteorological
Department's official forecasts and warnings in the user's own language,
before they ask.

Built for Smart India Hackathon 2026, Problem Statement 26068 (IMD, Ministry
of Earth Sciences). Team: Overcast. Live at chaatak.com.

---

## The one rule that shapes everything

**The LLM never generates a weather value.**

It may write freely *around* values it was handed. It may not produce one. A
number, a severity level, a warning category, a forecast — none of these may
originate in a model. Not as a fallback, not as an estimate, not when data is
missing, not when the user pushes. A hallucinated cyclone warning in a
disaster-management system is a safety incident, not a bug.

The model is allowed to be genuinely conversational because the output is
**verified programmatically before it ships**, not because it was asked nicely
in a prompt.

```
parse → fetch → render → VERIFY → ship
```

### What the rule does NOT say

It does not say the model must be terse, cautious, or mechanical. A weather
value is the only thing it may not originate. **Everything else is ordinary
assistant behaviour and is expected:** opinions, advice, recommendations,
follow-up questions, explanations, reasoning over the numbers it was handed,
casual conversation.

> "I wouldn't — there's a thunderstorm warning until this evening." — fine.
> "Winds are around 40 km/h." — only if 40 came from upstream.

**Advice is free; values are verified.** Do not read this rule more broadly
than it is written. An earlier reading of it suppressed normal assistant
behaviour, and that was wrong.

The LLM's jobs:

1. **Parse** — messy natural language into a structured query
   (intent, place, time window, variable). It *extracts* the place substring
   verbatim; it never normalises or transliterates it.
2. **Render** — answer the user. Report fetched values, reason over them,
   advise, explain, and converse, in the user's language and register.

### Scope: a weather assistant, not a general assistant

In scope: forecasts, warnings, anything that depends on conditions ("can I
play cricket", "should I travel", "what should I wear", "is it safe to spray
today", "when should I harvest"), explanations of weather terms, and questions
about Chaatak's own data and sources. Greetings and small talk on the way to a
weather question are fine.

Out of scope: coding, essays, general knowledge, maths, personal advice with
no weather bearing. Decline in **one friendly line** in the user's language
and register, then redirect. No lecture, no refusal boilerplate.

**The boundary is generous, and unsure resolves to in scope.** If a question
depends on weather in any way, answer it. `क्या आज घर से निकलूँ?` is a weather
question wearing casual clothes and must never be refused. Turning away a
farmer's real question is a worse failure than answering a slightly off-topic
one.

### Locked: advice never contradicts an active warning

Under an orange or red warning the model may not say conditions look fine.
Enforced programmatically, not by prompt, and with two independent defences
because one is not enough:

- **Structural.** The render is given the severity string and told the answer
  must open with it. A render that does not open with the severity is
  rejected outright, whatever it says afterwards.
- **Lexical.** Unnegated reassurance markers are rejected.

The lexicon is best-effort and will leak — Hindi has more ways to say "it's
fine" than any list will hold. Structure is what catches the ones vocabulary
misses, which is why the structural check is not optional.

Both checks are deliberately biased toward rejection. A false positive ships
the template, which already states the severity verbatim; a false negative
tells someone it is safe during a cyclone. Asymmetric consequences justify
asymmetric bias.

### The verification gate

Build the gate before the renderer. It is programmatic, never a prompt
instruction.

- Extract every numeral from the rendered output. Every one must appear in
  the fetched data. Any number that does not means the model invented it.
- Same check for place names.
- On any failure: **reject the render, ship the template response, log it.**

**A weather claim is a number adjacent to a unit or a variable.** That
definition is what keeps the gate usable. A turn that fetched nothing is held
to "no numeral near a measurement word" rather than "no numeral at all" —
otherwise "I can give you a 3-day forecast" is rejected for containing a 3,
and a gate that strict is theatre in the other direction.

Every rejection is logged **with the rejected text and the rule that caught
it**. Without that there is no way to tell an over-strict gate from a model
actually misbehaving, and that is exactly the distinction worth knowing before
a demo rather than after.

Two holes the naive version leaves open, both of which must be closed or the
gate is theatre:

- **Numeral scripts.** A Latin-only `\d` regex does not match `२५`, so a
  fabricated Devanagari number would never be extracted and would sail
  through. Normalise Devanagari digits to Latin before extracting.
- **Spelled-out numbers.** "पच्चीस डिग्री" contains no numeral at all and so
  passes a numeral check trivially. Values must always be rendered as
  digits; any number-word in the output is itself a rejection.

**Rule: every lexical defence in Devanagari matches whole words, never
substrings.** Single-character tokens are ordinary words in Hindi and also sit
inside common longer ones — the negator `न` occurs in `लेकिन`, `चेतावनी` and
`निकलना`. A `String.includes` check for it treats nearly every sentence as
negated and silently switches the whole defence off. This has now failed open
twice, in the number-word check and again in the reassurance check, so it is a
standing rule rather than a bug that was fixed. `\b` does not work here;
use explicit boundaries: `(?<![\p{L}\p{M}])word(?![\p{L}\p{M}])`.

### Locked: severity is never re-worded

Warning severity comes from the template catalogue **verbatim**. The model
writes around it and never restates it. The severity string is injected, not
generated, and re-wording is forbidden at the prompt level — because a model
softening "extremely heavy rain" into something milder produces a sentence
that is fluent, plausible, and passes every numeric check. It is the one
failure verification cannot catch, so it is prevented structurally instead.

### Register, script, dialect

- Mirror the user. Casual in, casual out. Devanagari in, Devanagari out.
  Hinglish in, Hinglish out. **Never switch script on the user.**
- Understand Haryanvi, Bhojpuri, Awadhi, Rajasthani and similar on input —
  they normalise toward Hindi and the parser handles it.
- Do **not** claim or fake native dialect output. Reply in the user's
  language, matching tone.

### Templates remain

Templates are the fallback whenever a render call fails or the gate rejects.
WMO codes, the warning taxonomy and spoken units stay enumerated and
human-translated. They are not legacy — they are the floor the system lands
on when the model is unavailable or wrong.

Practical consequences:

- Weather values reach the response layer only from a data adapter.
- If upstream has no data for a location, return an explicit `noData` state.
  Render "IMD has no data for your area" — never interpolate from a
  neighbouring district, never silently fall back to another source.
- Every value displayed carries provenance: which source, which endpoint,
  and the issue timestamp from the bulletin.

---

## Architecture

**Data adapters.** All weather sources sit behind one interface. Swapping
sources must never require touching application logic.

**The division of labour between sources is the data's, not a preference. IMD
is the authority on what is dangerous; Open-Meteo says what is happening this
hour.** IMD's synoptic stations report three-hourly and the endpoint serves
the last row whenever it is asked, so at six in the evening it returns the
twelve o'clock observation — correctly, with an honest timestamp — and
rendering it under "अभी" made every individual part true and the whole of it
false. `WEATHER_SOURCE=imd` therefore means warnings from IMD and readings
from Open-Meteo, each under its own name. The station transport is retained
and exported as `stationObservation`, for a caller that wants an observation
**as** an observation with its age attached. **Never let a stale observation
stand in for the present.**

The same pattern governs every external dependency — `WeatherSource`,
`PlaceResolver`, `SpeechSource`, `LanguageModel`. One interface, several
implementations, the primary chosen by a single config value, all keys
server-side.

**Place resolution is routed by script, not by language.** Open-Meteo's
geocoder returns nothing for Devanagari — not for मुंबई, not for जयपुर — so
Devanagari queries go to Nominatim and Latin queries stay on Open-Meteo.
Transliterating first was tried and rejected: it fails wrongly rather than
loudly, matching जयपुर to Jayapura in Indonesia and बाराबंकी to a Barabānki
in Odisha. This is script routing, never language detection; the user's
language is always an explicit choice.

```ts
interface WeatherSource {
  name: string;
  getCurrent(loc: Location): Promise<Reading | NoData>;
  getForecast(loc: Location, days: number): Promise<Forecast | NoData>;
  getWarnings(district: DistrictId): Promise<Warning[] | NoData>;
  getHistory(loc: Location, request: HistoryRequest): Promise<History | NoData>;
}
```

Every return type carries provenance, and provenance is not optional metadata
— it is part of the value. It states `source`, `issuedAt` and **`nature`**:
`observation`, `model` or `bulletin` — and, for the past, `archivedForecast`
or `reanalysis`, both modelled and **never called observations**, because
neither came from a gauge. A reader not told which they are looking at cannot
judge the number, and they age differently — `lib/weather/freshness.ts` keeps
a threshold per nature and gives an unknown nature the strictest one.

**History answers from history or says there is none.** A question about the
past never falls back to the current reading or the forecast; no record is
`noData`. Only finished hours and days are summarised. "Last rain" is an
event — wet hours grouped into spells, with a minimum total — never the last
hour that happened to read above zero.

**Age is measured from `observedAt ?? issuedAt`, never from `fetchedAt`.**
Fetch time is a property of the network; substituting it makes every stale
value look a second old, which is exactly the failure the freshness check
exists to catch. `endpoint` is kept for traceability and is **never
rendered** — an API path tells a farmer nothing and tells everyone else our
URL structure.

**Caching.** Cache upstream responses server-side with per-endpoint TTL
matched to how often that endpoint actually updates. Nowcast refreshes far
more often than a 7-day forecast. IMD's own API guidelines ask for caching,
and response latency is a scored evaluation criterion.

**The weather surface adopts a snapshot; it does not re-fetch one.** The rail
beside the conversation shows the same values the answer was written from. Two
surfaces fetching independently will eventually disagree by a degree because
they landed in different cache windows, and a reader cannot tell which to
believe. One fetch, one snapshot, both surfaces. With no conversation location
and no granted permission the rail states that it does not know, and offers;
it never guesses a city.

**The map draws only geometry that exists.** IMD publishes a hazard code per
district id and no geometry of any kind, so the alerts layer renders districts
and never a polygon we invented — a boundary that is nearly right tells
somebody on the wrong side of it that they are safe. The base-map provider is
abstracted from the weather layers and carries its attribution; sampling is
capped per viewport rather than scaled with it.

**Air quality is named for the scale it is on.** CPCB's National AQI is primary:
the nearest CPCB station within 25 km of the canonical place with a current,
complete reading, named with its distance, as an observation with the
station's own time. CPCB publishes sub-indices, so the AQI is CPCB's rule — the
highest sub-index, only with three pollutants including PM2.5 or PM10 — and
never a sub-index recomputed as if it were a concentration. Where CPCB has
nothing, the fallback is modelled (Open-Meteo/CAMS) on the **European**
breakpoints, labelled modelled and European in the interface, and it states
why CPCB was not used; it is never relabelled as CPCB. A model-derived European
number presented as "AQI" is silently misread by anyone who knows the Indian
scale. The map follows the same source and never paints a field between
stations. `AirQualitySource` is the interface all of this sits behind.

**Intent routing. The LLM is the exception path, not the default.** We are on
free tiers with no billing, so the pattern layer is load-bearing architecture
rather than an optimisation. Three layers, in order:

1. **Patterns.** Regex plus a place gazetteer handles bare place names,
   `<place> mein mausam`, `kal barish`, `aaj ka mausam` and common variants
   in both scripts. No model call. Target sub-200ms.
2. **Parse cache**, keyed on `(normalisedText, lang)` with a short TTL.
   Twenty people asking the same thing is one call.
3. **LLM parse**, only for what patterns and cache both miss.

Log which layer served each query. We must be able to state what percentage
of traffic never touched a model.

**Understand the turn before looking for a place.** What a turn IS —
greeting, reaction, thanks, correction, follow-up, a request for a language, a
weather question — is decided first (`lib/chat/understand.ts`), and only a
turn that needs a place gets one resolved. "wassup", "ohh really" and "that's
crazy" are conversation, answered without a fetch; a failed parse is asked
about and **never geocoded as a whole message**. A place the model names must
be a verbatim slice of what the user wrote.

**A place is claimed on evidence, never on position.** A particle marks a noun,
not a place: "दोस्त के साथ" is *with* a friend, "office mein" is in an office. So
the local reader claims only a gazetteer-known name in a real place slot (के /
का are slots only before weather, time or nearness words), a known name
standing alone, or the answer to "which place?" (`lib/parse/place-extract.ts`).
Anything unconfirmed goes to the classifier, which sees the conversation; it is
never shortened to a known name ("Rampur Khas" is not Rampur), never fuzzily
repaired inside a sentence ("mandir" is one edit from Mandi), and never
geocoded. A weather question that names no place — advice included ("can I
play cricket tomorrow evening?") — carries the conversation's, and a part of
the day ("कल शाम") narrows the window without inventing hourly values. The
conversation carries forward
in the `StandingQuery` — place, topic, window, a question still waiting for a
place, the language — and the server distrusts it: the place is re-resolved
from its name every turn, and a severity in it can only tighten the gate.

**Warning vocabulary is never machine-translated.** IMD's district warning
codes (17) and nowcast categories (19) are a fixed enumerated set. They are
human-translated once and stored as templates keyed by code and language.
Free-text narrative may be machine-translated; the severity taxonomy may not.
MT can soften "extremely heavy rain" into something milder — a safety failure.

**Alert dispatch.** A scheduled job polls district warnings independently of
user activity, matches against subscribed districts, and dispatches. The
pipeline never calls a model: severity comes from the template catalogue
verbatim, in the subscriber's language, with provenance.

Deduplication is on `(subscriberId, dispatchKey)` in Postgres, where
`dispatchKey = warningId:fingerprint` and the fingerprint covers only the
**material** fields — severity, hazard code, district, and the validity window
truncated to the hour.

> ⚠ **`issuedAt` is deliberately excluded from the fingerprint, and this is an
> ASSUMPTION about IMD that must be verified against real bulletins when the
> key lands.** The assumption: IMD restamps `issuedAt` on every reissue,
> including unchanged ones. If that holds, including it would mean ~80
> dispatches for one six-hour warning polled every five minutes. If it does
> **not** hold — if IMD keeps `issuedAt` stable and signals a reissue some
> other way — then this dedup is wrong in the direction of **silence**, which
> is the dangerous direction. Watch one real warning across several polls
> before trusting it. The per-poll log prints every fingerprint with a
> `changed` flag precisely so a genuine reissue can be told from a
> restatement.

The claim is an atomic conditional upsert, never a read followed by a write,
so concurrent invocations produce one dispatch. Claims are **leases**: a runner
that claims and then dies would otherwise block the dispatch forever, and a
silently dropped warning is the worst outcome this system has. The honest
guarantee is therefore **at-least-once**, not exactly-once — duplicating a
cyclone warning beats dropping it.

A warning that vanishes from the feed **before** its window closes was
withdrawn, and dispatches an all-clear. One that vanishes **after** simply
expired, and dispatches nothing — expiry is expected, and an all-clear for it
is the kind of noise that trains people to ignore us.

**Telegram is a client, not a second product.** The bot calls
`answerQuestion` (lib/chat/answer.ts) — the same pipeline and gate the web
route calls — and `snapshotFor` for cards; saves places through the account
store; follows the account's language preferences (no Telegram language
setting); and receives alerts as a channel of the existing daemon. A chat is
linked to an account only by consuming a one-time link token that a signed-in
session created. Details in [`docs/telegram.md`](./docs/telegram.md). Do not
give it weather, place, alert or preference logic of its own.

**Secrets stay server-side.** All third-party calls (IMD, Bhashini, LLM) go
through Next.js API routes. No API key ever reaches the browser.

**Accounts are optional configuration, and identity is never client-supplied.**
Supabase Auth is the source of truth: every account route starts with
`getUser()`, which validates the session token against the auth server.
`getSession()` — which decodes the cookie without checking a signature — is
not wired up anywhere, because the two look interchangeable and are not.

Ownership is enforced twice, and neither defence relies on the other. Server
routes reach Postgres as `postgres` and scope every statement by that verified
user id. Row-level security says the same thing in the database, and is what
stands between two accounts on Supabase's public PostgREST endpoint, which the
browser can reach with the anon key it now holds. `npm run verify:rls` proves
it by becoming the `authenticated` role and trying.

**Three language preferences, never one.** Interface, assistant and voice are
independent: choosing a voice cannot change the script of written text, and
someone can read English chrome while asking and being answered in Hindi. Each
defaults to `auto`, and `auto` means something different and specific for
each — the device's ordered `navigator.languages` for the interface, the
language, script and register of each turn for the assistant, and the
language actually spoken for voice. An explicit choice is never overridden by
a device change.

**The reply's language is decided before anything is written**, in
`lib/i18n/detect.ts` — the one language system — and handed to the renderer
and the templates, never left for a model to guess. Hinglish is answered in
Latin-script Hindi: not English, not Devanagari. A short turn ("ok", "ohh
really") carries too little evidence and inherits the conversation's language.
**Voice detection is never faked:** a recogniser that cannot detect a language
says which one it is listening in.

Automatic interface detection follows `support.interface`, so a language
becomes detectable in the same commit that makes it readable — Hindi and
English today, and nothing else until its strings exist. The five speech-only
languages can still be chosen; the interface borrows Hindi or English for them
and says so rather than implying a completeness that is not there.

**A saved place and a notification are separate decisions.** Device location
is requested at the one moment a question cannot be answered without it, and
never again after a refusal; notification permission is requested only when
someone presses the control that says what it will do. Granting one never
implies the other. A coordinate resolves through the existing gazetteer — not
a second geocoder — and is then discarded: what a monitored location stores is
the canonical town's coordinate, never the device's fix.

**The three-location limit is a unique constraint, not a count.** `slot` is
restricted to 1–3 and unique per user, so two requests arriving together
cannot both become the third. A count read before an insert would have looked
identical and been wrong in exactly the case worth getting right. Identity is
the district, because a district is what IMD warns on.

**Stack.** Next.js (App Router, TypeScript) · Node API routes on Vercel ·
PostgreSQL via Supabase · MapLibre GL · Web Push (VAPID) · Telegram Bot API ·
Bhashini (ULCA/Dhruva) for ASR/MT/TTS, with the browser Web Speech API as the
prototype fallback. No Docker, no Kubernetes, no microservices.

---

## Design direction

The audience is a farmer in a field, not an analyst at a desk. Poor eyesight,
limited literacy, a cheap Android phone, a weak connection, bright sunlight.
Every decision answers to that. A city user can use an interface built for a
farmer; the reverse is not true.

**The genre is an official notice, not a consumer weather app.**

Do not build: sky-blue gradients, glassmorphism, weather icon sets, a big
centred temperature over a photo, cards floating on a background image. That
is the default for this category and it is wrong for a warning system.

**Severity is the layout, not an accent.** IMD's warning colour is a
full-bleed band at the top of the content. It is the first thing seen.
Colour never works alone — the severity is also written out in words, for
colour-blind users and for bright sunlight.

**Restraint in colour.** Black, grey, warm paper. Severity colours mean
something. One teal accent marks what is interactive. Nothing else is
coloured.

**The interface renders in ONE language, chosen or detected.** It used to be
bilingual everywhere — a Hindi line with an English line under it, on every
label — which was the right answer while there was no language setting and
the wrong one once there was: a farmer who chose Hindi should not read English
under every button, and an English reader should not be shown Devanagari.
Every string lives in `lib/i18n/strings.ts`, human-written in both, never
machine-translated. Devanagari needs more line-height than Latin; the document's
own `lang` carries it, so `:lang(hi)` in `brand.css` applies by inheritance
rather than by tagging each element.

**The microphone is the largest element on screen.** Voice is the input;
text is the fallback.

**The provenance line is a design element**, not fine print. It sits on a 2px
rule in the active severity colour, and appears under every value.

**Quality floor, unannounced:** works at 360px, visible keyboard focus,
reduced motion respected, real contrast ratios, large touch targets, usable
one-handed.

**Copy.** Plain verbs, sentence case, no filler. Errors say what happened and
what to do. The no-data state is not an apology — it is a statement that IMD
has not issued a bulletin.

### Reference screens

```
Header        logo mark + location, thin rule beneath
Warning       full-bleed severity band. Severity written in words at 10.5px
              caps. Hindi headline 22px/1.35. English subtitle 14px.
Body          16–17px, line-height 1.6
Provenance    2px rule in the active severity colour, then icon + source +
              issue time at 11.5px
No data       grey field, 3px left rule, caps label, statement beneath
Mic           74px filled circle in the accent, centred, largest element.
              52px when paired with a text input.
```

The provenance rule takes the colour of the source's severity — orange under
a warning, green under an ordinary forecast. Severity stays legible even from
the citation.

### Brand assets

In `/public` and `app/`. Full mark at 40px and above; cropped head below —
the full mark fills in and stops reading at small sizes. Tokens in
`brand.css`. Fonts: Instrument Sans (Latin), Noto Sans Devanagari, both via
`next/font`.

### Styling

**Chaatak surfaces are plain CSS on `brand.css` tokens. There is no Tailwind
in this project — it was removed, deliberately.** The reference screens are
specified in exact pixel values and in semantic severity tokens, which a
utility framework expresses only as a wall of arbitrary values, and the
severity tokens must stay named so a colour cannot drift loose from the
meaning it carries. `app/globals.css` holds the reset and element defaults;
`app/chaatak.css` holds component classes; `brand.css` holds every colour.
Do not reintroduce Tailwind or add a second styling system alongside this one.

**These design constraints take precedence over any general design skill or
guidance. Where a skill suggests a treatment that conflicts with the above,
follow the above. This is a public-safety interface, not a portfolio piece.**

---

## Build phases

Do not start a phase until the previous one works end to end and is deployed.
Commit after every working step. Deploy after every phase.

### Phase 0 — Foundation
Brand assets in place, `brand.css` imported, fonts loading, logo in the
header, favicon set. Deployed and opening correctly on a phone.

### Phase 1 — The weather query
`WeatherSource` interface with the Open-Meteo implementation. A page that
takes a place name, geocodes it, and returns current conditions plus a 3-day
outlook. The shared `Provenance` component, built first and used by
everything. The `noData` state, rendered as a statement.
**Done when:** a real value appears on screen with a real source and issue
time, and a nonsense place name produces the no-data state rather than an
error.

### Phase 2 — Voice
Speech in and speech out. Web Speech API first, since it needs no key and
works today. Bhashini behind the same interface so it can be swapped in.
Two languages only — Hindi and English — tested on real accented speech.
**Done when:** you can speak a question in Hindi and hear the answer spoken
back, on a phone, without touching the keyboard.

### Phase 3 — Chat ✅
Message list, turn memory with a bounded context window, advisory answers
grounded in verified values, and the scope boundary. The gate extended for
conversation. Done.

### Phase 4 — Districts and alerts ✅
Saved districts, the alert daemon as a cron-driven endpoint, idempotency on
`(subscriberId, dispatchKey)` in Postgres, Web Push and Telegram dispatch,
and the withdrawal all-clear. Built against a fixture warning source, since
Open-Meteo has no warning product; IMD swaps in behind the same adapter.
**Done when:** a warning reaches a phone without anyone asking, running the
job twice sends it once, a withdrawn warning sends an all-clear and an
expired one sends nothing. Done.

### Phase 5 — IMD swap-in (warnings done)
`WEATHER_SOURCE=imd` serves district warnings from IMD through the same
`WeatherSource` interface, with the warning-code template catalogue and the
lat/lon → district `Obj_id` resolver. Nothing above the adapter layer changed,
which was the point of the interface. `npm run verify:imd` re-derives IMD's
undocumented colour ordering against live data and fails if it stops holding.

**Deliberately not done:** current conditions and the forecast stay on
Open-Meteo, under Open-Meteo's name. See the division of labour above — the
station endpoint cannot say what is happening now, so this is a data
constraint rather than a config change waiting to be made.

### Phase 6 — Polish
Dark mode. Offline behaviour — cache the last warning locally and show it
with its timestamp and its age. Loading and empty states. Accessibility pass
at 360px.
**Done when:** you can turn off wifi and the app still shows the last known
warning, honestly labelled as stale.

### Phase 7 — Accounts ✅
Google sign-in through Supabase Auth, chat history, monitored locations and
automatic "use my location". Guests still ask and are still answered — login
is required for persistence, never for a forecast. Accounts are optional
configuration: without the two `NEXT_PUBLIC_SUPABASE_*` values the sign-in
control is absent and everything else works. Set-up is in
[`docs/accounts-setup.md`](./docs/accounts-setup.md). Done.

### Phase 8 — Demo
Rehearse the demo path. Record the video: a spoken question in Hindi
returning a real IMD value with a visible issue time, then an alert firing
unprompted.

**Cut without guilt:** maps, ten languages, climate charts, aviation, Docker,
Kubernetes. None of them change whether a farmer gets a warning.

---

## Non-negotiables checklist

- [ ] No weather value originates anywhere except a data adapter
- [ ] Every displayed value shows source and issue time
- [ ] `noData` renders as a statement, never as an estimate
- [ ] A stale observation never renders as the present
- [ ] Every value states its nature: observation, model, bulletin, archived forecast or reanalysis
- [ ] A conversational turn is never geocoded
- [ ] An unconfirmed word is never geocoded — a noun beside a particle is not a place
- [ ] A history question never falls back to now or the forecast
- [ ] The map draws no boundary IMD did not publish
- [ ] A modelled European index is never called India's official AQI
- [ ] Warning taxonomy renders from templates, never live MT
- [ ] No API key in client code
- [ ] Alerts deduplicate on `(userId, warningId)`
- [ ] No account route trusts a user id from the request
- [ ] RLS denies every table in `public` to `anon` by default
- [ ] A permission is asked for only when the thing it enables was asked for
- [ ] Interface strings come from the catalogue, never machine-translated
- [ ] Choosing one language preference never moves another
- [ ] Hindi text renders correctly at every breakpoint
- [ ] Works at 360px, one-handed, in sunlight

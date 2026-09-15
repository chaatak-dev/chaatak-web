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

**Data adapters.** All weather sources sit behind one interface. IMD is
primary; Open-Meteo is the development fallback while IMD API access is
pending. Swapping sources must never require touching application logic.

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
}
```

Every return type carries `{ source, endpoint, issuedAt }`. Provenance is not
optional metadata — it is part of the value.

**Caching.** Cache upstream responses server-side with per-endpoint TTL
matched to how often that endpoint actually updates. Nowcast refreshes far
more often than a 7-day forecast. IMD's own API guidelines ask for caching,
and response latency is a scored evaluation criterion.

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

**Secrets stay server-side.** All third-party calls (IMD, Bhashini, LLM) go
through Next.js API routes. No API key ever reaches the browser.

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

**Hindi is primary in the type hierarchy**, English is the subtitle.
Devanagari needs more line-height than Latin — tag with `lang="hi"` and
`brand.css` handles it.

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

### Phase 5 — IMD swap-in
When the API key arrives: implement `WeatherSource` against IMD, build the
location resolver (lat/lon → district Obj_id → nearest station) and the
warning-code template catalogue. Change one config value to switch sources.
**Done when:** the same UI shows IMD data with IMD provenance, and nothing
above the adapter layer changed.

### Phase 6 — Polish
Dark mode. Offline behaviour — cache the last warning locally and show it
with its timestamp and its age. Loading and empty states. Accessibility pass
at 360px.
**Done when:** you can turn off wifi and the app still shows the last known
warning, honestly labelled as stale.

### Phase 7 — Demo
Auth, chat history and settings only if time remains; none of them change
whether this works. Rehearse the demo path. Record the video: a spoken
question in Hindi returning a real IMD value with a visible issue time, then
an alert firing unprompted.

**Cut without guilt:** maps, ten languages, climate charts, aviation, Docker,
Kubernetes. None of them change whether a farmer gets a warning.

---

## Non-negotiables checklist

- [ ] No weather value originates anywhere except a data adapter
- [ ] Every displayed value shows source and issue time
- [ ] `noData` renders as a statement, never as an estimate
- [ ] Warning taxonomy renders from templates, never live MT
- [ ] No API key in client code
- [ ] Alerts deduplicate on `(userId, warningId)`
- [ ] Hindi text renders correctly at every breakpoint
- [ ] Works at 360px, one-handed, in sunlight

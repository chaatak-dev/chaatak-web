# Chaatak

Voice-first early warning for rural India. Speaks the India Meteorological
Department's official forecasts and warnings in the user's own language,
before they ask.

Built for Smart India Hackathon 2026, Problem Statement 26068 (IMD, Ministry
of Earth Sciences). Team: Overcast. Live at chaatak.com.

---

## The one rule that shapes everything

**This system never generates weather information. It only retrieves and renders it.**

The LLM has exactly two jobs:

1. **Parse** — turn a natural-language question into a structured query
   (intent, location, time window, variable).
2. **Render** — turn retrieved values into a sentence in the user's language.

The LLM must never produce a number, a severity level, a warning category, or
a forecast. Not as a fallback, not as an estimate, not when data is missing,
not when the user pushes. A hallucinated cyclone warning in a disaster-
management system is a safety incident, not a bug.

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

**Intent routing.** Simple lookups ("temperature in Ghaziabad") bypass the LLM
entirely and serve a cached template response. Only ambiguous or multi-part
questions go to the model. Target sub-200ms for the fast path.

**Warning vocabulary is never machine-translated.** IMD's district warning
codes (17) and nowcast categories (19) are a fixed enumerated set. They are
human-translated once and stored as templates keyed by code and language.
Free-text narrative may be machine-translated; the severity taxonomy may not.
MT can soften "extremely heavy rain" into something milder — a safety failure.

**Alert dispatch.** A scheduled job polls district warnings independently of
user activity, matches against subscribed districts, and dispatches.
Deduplicate on `(userId, warningId)` with an idempotency table — polling every
few minutes will otherwise send the same warning repeatedly.

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

### Phase 3 — Districts and alerts
Saved districts (localStorage is fine at this stage — no auth yet). The alert
daemon as a scheduled job. Idempotency table keyed on `(user, warningId)`.
Web Push and Telegram dispatch.
**Done when:** a warning fires and reaches a phone without anyone asking for
it, and firing the job twice does not send it twice.

### Phase 4 — IMD swap-in
When the API key arrives: implement `WeatherSource` against IMD, build the
location resolver (lat/lon → district Obj_id → nearest station) and the
warning-code template catalogue. Change one config value to switch sources.
**Done when:** the same UI shows IMD data with IMD provenance, and nothing
above the adapter layer changed.

### Phase 5 — Polish
Dark mode. Offline behaviour — cache the last warning locally and show it
with its timestamp and its age. Loading and empty states. Accessibility pass
at 360px.
**Done when:** you can turn off wifi and the app still shows the last known
warning, honestly labelled as stale.

### Phase 6 — Demo
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

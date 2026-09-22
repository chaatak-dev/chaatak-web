# Telegram

Chaatak in Telegram is **another client of the same backend**, not a second
product. The bot asks every question through the same pipeline the website
uses, shows the same snapshot, saves places through the same account store,
and receives IMD warnings through the same alert daemon.

```
Website ─┐
Telegram ├─→ answerQuestion()   parse → fetch → render → VERIFY → ship
(Mini    │   snapshotFor()      Open-Meteo now/forecast, IMD warnings
 App)   ─┘   accounts store     monitored locations, language preferences
             alert daemon       poll → claim → dispatch (web push, Telegram)
```

What Telegram adds, and nothing more:

| | |
| --- | --- |
| `lib/telegram/bot.ts` | Routing: commands, questions, locations, buttons, linking |
| `lib/telegram/render.ts` | How things look: HTML, keyboards, the alert layout |
| `lib/telegram/store.ts` | Chat ↔ account links, link tokens, update ids, chat context |
| `lib/telegram/api.ts` | The one Bot API client — replies and alerts both use it |
| `app/api/telegram/webhook` | Where Telegram delivers updates |
| `app/api/telegram` | Connect, status and disconnect, for a signed-in account |
| `migrations/004_telegram.sql` | Three small tables |

---

## One-time production setup

The two secrets are already in Vercel and `.env.local`:
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Nothing below prints
either.

1. **Apply the migration** (idempotent; safe to re-run):

   ```bash
   npm run migrate
   ```

2. **Deploy** the build that contains `/api/telegram/webhook`.
   Do this *before* step 4 — a webhook pointed at a deployment without the
   route gets 404s, and Telegram retries and queues updates behind them.

3. **Look before changing anything** (read-only):

   ```bash
   npm run telegram:setup
   ```

   It shows the bot, where its webhook points now, how many updates are
   waiting, the last delivery error, and a plan of what `--apply` would change.

4. **Apply**:

   ```bash
   npm run telegram:setup -- --apply --photo
   ```

   This registers the webhook (`https://chaatak.com/api/telegram/webhook`,
   with the secret, for `message`, `callback_query` and `my_chat_member`
   updates, never dropping pending ones), sets the command menu, name, short
   description and description in English and Hindi, and uploads the profile
   photo. Leave out `--photo` to keep the current one.

   If the webhook already points somewhere else, the script refuses to move
   it and says so. Pass `--replace-webhook` only if moving it is the intent.

5. **Check**: run `npm run telegram:setup` again — the webhook should be the
   production URL with 0 pending and no last error — then send `/start` to
   [@ChaatakBot](https://t.me/ChaatakBot).

**Optional, BotFather only** (the Bot API cannot set it): the bot answers in
private chats and ignores groups, so *Bot Settings → Allow Groups → off*
stops it being added to one in the first place.

### Rotating the webhook secret

Change `TELEGRAM_WEBHOOK_SECRET` in Vercel, redeploy, then
`npm run telegram:setup -- --apply --resend-secret`. Between the deploy and
the re-registration, deliveries carry the old secret and are refused with
401; Telegram retries them, so nothing is lost if the gap is short.

### Environment

| Variable | |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Required. The bot. Also enables the alert channel. |
| `TELEGRAM_WEBHOOK_SECRET` | Required for the webhook. Without it the endpoint answers 503, closed rather than open. |
| `CHAATAK_SITE_URL` | Optional. Where "Open Chaatak" links go. Defaults to `https://chaatak.com`. |
| `TELEGRAM_API_BASE` | Optional. A self-hosted Bot API server, or a local stub for testing. Plain `http` is accepted only for loopback. |

---

## What people can do

- **Ask**, the way they would ask a person — typed, in any of the scripts the
  website reads. The answer is the pipeline's verified answer, with the IMD
  severity above it when a warning is in force and the provenance below it.
- **📍 Weather here** — the persistent key under the text box. Telegram asks
  for the location, only when it is pressed. The point is resolved to the
  nearest gazetteer town and **the coordinate is not kept**.
- **"Which place?"** — a question with no place is asked back, with the
  person's saved places as one-tap buttons. A location share, a saved place or
  a typed name answers the waiting question; it is not asked again.
- **/weather** — a card: warnings, now, the next three days, each under its
  own source line. **↻ Refresh** replaces it in place.
- **🔔 Get alerts for …** — on cards, and under answers for a connected
  account. Saves a monitored location through the account's own store: the
  same three-place limit and one-district rule as the website.
- **/locations**, **/alerts**, **/settings** — saved places (tap for weather,
  remove in place), pausing alerts in this chat, the reply language and
  disconnecting.

Alerts arrive unasked, laid out from the alert catalogue: severity and
"Official IMD warning" first, then the hazard, the district and until when,
the action line, and the bulletin's issue time. An all-clear arrives silently.

---

## Connecting an account

1. On chaatak.com, **Settings → Alert notifications → Connect Telegram**.
   The server mints a one-time link for the *session's* account.
2. **Open Telegram** follows it: `t.me/ChaatakBot?start=link_<token>`.
3. The bot names the account — first name and masked email — and asks.
   Nothing is linked until **Connect** is pressed.
4. The settings panel notices within a few seconds and shows
   *Connected as @username*.

The bot's own "Connect on chaatak.com" button opens
`chaatak.com/?connect=telegram`, which opens settings (after sign-in, if
needed) at the same control.

### Why it is safe

| Property | How |
| --- | --- |
| The link carries nothing | 32 random bytes, base64url. No id, email or time. |
| A database read yields nothing usable | Only a SHA-256 of the token is stored. |
| Short-lived | 10 minutes. Making a new link retires the previous one. |
| Single use | Consumed by an atomic update on Connect; a replay finds nothing. |
| Not transferable once opened | Bound to the first chat that presents it. A forwarded link is dead in any other chat. |
| No silent switching | A chat linked to one account is never moved to another by a link; the person must disconnect first. |
| Visible takeover | Connecting a second Telegram unlinks the first, which is told — so an owner who did not do it finds out. |
| Identity is never client-supplied | Every `/api/telegram` verb starts with `getUser()`; the bot links only by consuming a token. |
| Login-CSRF | The confirmation names the account, so a link someone else made shows their account, and can be refused. |

### Idempotency and failure

- Telegram's `update_id` is claimed with one atomic insert before anything
  runs; a redelivered update is acknowledged and dropped. With the database
  unreachable, dedup degrades to per-instance and the bot keeps answering.
- The webhook acknowledges immediately and does the work in `after()`, so a
  model call never holds Telegram's delivery open. The guarantee for a *reply*
  is at-most-once. Alerts do not take this path: they are dispatched by the
  cron daemon with leases, retries and the `(subscriberId, dispatchKey)` claim.
- 403, or 400 "chat not found", removes a chat's alert channel. Any other 400
  is a bug in our message, and does **not** — an earlier sender treated every
  400 as a dead chat, which a single unparseable district name would have
  turned into silence.
- 429 is waited out when short, returned when long. Inbound, a chat gets 20
  messages a minute, one "slow down", then silence for the window.

---

## Language

There is no Telegram language setting. The bot follows the account's
existing preferences — `assistant_lang` first — and, like the website,
mirrors the person when that is **Auto**. For a tap or a location share, where
there are no words to mirror, the chain is: assistant preference → the
language of the last message → interface preference → Telegram's
`language_code` → English. Telegram's language is only ever the fallback.

Changing the reply language in `/settings` writes the account's own
`assistant_lang`, through the same function the website's settings use, so it
changes on chaatak.com too. Alerts keep the existing alert-language rule.

---

## Testing locally

```bash
npm test                    # includes the bot, the webhook and the channel
npm run verify:accounts     # the Telegram SQL against the real database
```

For an end-to-end run without messaging real people, point the Bot API at a
recording stub on loopback and post updates to the local webhook with the
secret header:

```bash
TELEGRAM_API_BASE=http://127.0.0.1:8081 npm run start
```

---

## Toward a Mini App

Not built. The pieces it needs are already the right shape:

- **Identity.** A Mini App's signed `initData` carries the Telegram user id,
  which in a private chat *is* `telegram_chats.chat_id`. An endpoint that
  verifies `initData` (HMAC with the bot token) and looks up that row knows the
  linked account without a second sign-in system.
- **The frontend.** The website already works at 360px, one-handed. A Mini
  App is chaatak.com opened in Telegram's webview with a thin adapter for
  Telegram's theme and back button — not a second app.
- **The backend.** Everything it would call — `answerQuestion`,
  `snapshotFor`, the account store — is already shared by two clients.
- **The entry point.** "Open Chaatak" is a plain URL button today; it becomes
  a `web_app` button, and the menu button can open it, without changing
  anything around it.

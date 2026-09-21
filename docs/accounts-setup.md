# Accounts: the configuration you have to do by hand

Everything in the codebase is done. What is left is four values in two
dashboards, and none of them are pasted into a chat window or committed to
this repository.

**Until these are set, Chaatak runs exactly as it did before.** Weather,
voice, warnings and the alert daemon do not touch an account. The sign-in
control is absent rather than broken, guests keep their conversation in the
tab, and `/api/account` answers `{"configured": false}`. Adding the values
turns accounts on; removing them turns accounts off. Nothing else changes.

---

## 1. Google Cloud — an OAuth client

<https://console.cloud.google.com/>

1. Create a project, or pick an existing one.
2. **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: `Chaatak`
   - User support email: yours
   - Authorised domains: `chaatak.com` and `supabase.co`
   - Scopes: the defaults (`email`, `profile`, `openid`). **Add nothing
     else.** Chaatak calls no Google API on anyone's behalf, so any further
     scope would be a permission it has no use for.
   - While the app is in **Testing**, only accounts listed under *Test users*
     can sign in. Add the demo accounts, or **Publish** the app.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `Chaatak web`
   - **Authorised JavaScript origins**

     ```
     https://chaatak.com
     http://localhost:3000
     ```

   - **Authorised redirect URIs** — this is Supabase's callback, not
     Chaatak's. Google redirects to Supabase, Supabase redirects to us.

     ```
     https://ghdfstuvmzhzuhkborzd.supabase.co/auth/v1/callback
     ```

4. Copy the **Client ID** and **Client secret**. They go into Supabase in the
   next step and nowhere else — not into `.env.local`, not into Vercel, not
   into this repository.

---

## 2. Supabase — enable Google, and set the redirect URLs

<https://supabase.com/dashboard> → project `ghdfstuvmzhzuhkborzd`

1. **Authentication → Sign In / Providers → Google**
   - Enable it.
   - Paste the Client ID and Client secret from step 1.
   - Save.
2. **Authentication → URL Configuration**
   - **Site URL**: `https://chaatak.com`
   - **Redirect URLs** — add each of these:

     ```
     https://chaatak.com/api/auth/callback
     http://localhost:3000/api/auth/callback
     https://*-overcast.vercel.app/api/auth/callback
     ```

     The third line is for Vercel preview deployments; adjust it to your own
     preview host, or leave it out if you only ever sign in on production and
     locally. A redirect URL that is not on this list is refused by Supabase,
     which is the behaviour you want — it is what stops a sign-in link being
     used to bounce somebody somewhere else.
3. **Project Settings → API keys**
   - Copy the **Project URL** and the **anon / publishable** key.
   - **Do not copy the `service_role` key.** Nothing in this codebase reads
     it. Server routes reach Postgres through `DATABASE_URL`, and the
     service-role key existing in an environment variable is a standing risk
     with no matching benefit.

---

## 3. The two environment variables

Local — append to `.env.local` (gitignored):

```
NEXT_PUBLIC_SUPABASE_URL=https://ghdfstuvmzhzuhkborzd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon / publishable key>
```

Production — add the same two to the Vercel project, for **Production,
Preview and Development**, then redeploy. `NEXT_PUBLIC_` values are compiled
into the browser bundle, so a deployment made before they were added does not
pick them up.

**`NEXT_PUBLIC_` on both is correct and not an oversight.** The project URL
and the anon key are published to the browser by design: the anon key carries
no authority of its own, it identifies the project, and every row it can
reach is decided by row-level security against a verified JWT. Run
`npm run verify:rls` to see that demonstrated rather than asserted.

---

## 4. The database

```bash
npm run migrate            # applies migrations/, then prints RLS state
npm run verify:rls         # proves one account cannot reach another's data
npm run verify:accounts    # runs every account flow against the real store
```

`npm run migrate` is idempotent and safe on the existing production database:
every statement is `IF NOT EXISTS` or guarded by a catalogue lookup. It has
already been applied to `ghdfstuvmzhzuhkborzd`.

Both verification scripts create throwaway accounts and delete them again,
including when an assertion fails.

---

## 5. Notifications (already configured)

Nothing to do. `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are already set from
Phase 4, and the public half is served to the browser from
`GET /api/alerts/push` rather than being inlined as a second copy.

If they are ever absent, the interface says push is unavailable on this
deployment and saved places keep working — they are simply looked at rather
than pushed.

---

## What to check once it is on

| Step | Expected |
| --- | --- |
| Open the app signed out | Weather answers. No sign-in wall. |
| Ask two questions, then sign in | Both turns appear under **Recent**, in order |
| Reload | The conversation is still there |
| Open on a second device, same Google account | The same chats and the same places |
| Save three places, try a fourth | Refused, server-side. `npm run verify:accounts` asserts this |
| Save a second place in a district already watched | Refused, naming the place that already covers it |
| Ask "temperature" with no place | Asks for location **once**, at that moment |
| Say no, then ask again | Does not re-prompt; offers **Use my location** and the text box |
| Ask "weather in Delhi" | Never asks for location |
| Save a place | Does **not** ask for notification permission |
| Press *Warn me about these places* | Asks for notification permission, then it is on |
| Delete account | Chats, messages, places, profile and alert subscription all gone |

/**
 * Registers the Telegram bot's webhook and profile, and shows what is set.
 *
 *   npm run telegram:setup                       read-only: what is set, what would change
 *   npm run telegram:setup -- --apply            apply the changes it listed
 *   npm run telegram:setup -- --apply --photo    …and upload the profile photo
 *
 * Options:
 *   --url <https://…/api/telegram/webhook>   the webhook (default: production)
 *   --replace-webhook   required to replace a webhook that points somewhere
 *                       ELSE — this script never silently takes over a bot
 *                       that is being served by another deployment
 *   --resend-secret     re-register an unchanged webhook, to push a rotated
 *                       TELEGRAM_WEBHOOK_SECRET (Telegram cannot say which
 *                       secret it holds, so an unchanged URL is otherwise
 *                       left alone)
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the environment
 * or .env.local. Prints neither, ever: the token is only ever inside a request
 * URL, and no request URL is printed.
 *
 * Names, descriptions and the command menu come from lib/i18n/strings.ts, the
 * same catalogue the bot speaks from, in English (Telegram's default) and
 * Hindi (for clients set to Hindi).
 */

import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const key = t.slice(0, i).trim();
    // The shell wins over the file, so a production value can be passed for
    // one run without editing anything.
    if (process.env[key] === undefined) {
      process.env[key] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
}

const { callTelegram, apiBase } = await import('../lib/telegram/api.js');
const { commandMenu } = await import('../lib/telegram/render.js');
const { translate } = await import('../lib/i18n/strings.js');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const APPLY = flag('--apply');
const PHOTO = flag('--photo');
const URL_TARGET = option('--url') ?? 'https://chaatak.com/api/telegram/webhook';
const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'];
const MAX_CONNECTIONS = 20;
const AVATAR = 'public/brand/chaatak-telegram-avatar.jpg';

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!process.env.TELEGRAM_BOT_TOKEN) fail('TELEGRAM_BOT_TOKEN is not set.');
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  fail('TELEGRAM_WEBHOOK_SECRET must be 1–256 characters of A–Z, a–z, 0–9, _ or -.');
}
if (!/^https:\/\/[^/]+\/api\/telegram\/webhook$/.test(URL_TARGET)) {
  fail(`--url must be an https URL ending in /api/telegram/webhook (got ${URL_TARGET}).`);
}

async function get<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const result = await callTelegram<T>(method, params, { retries: 1 });
  if (!result.ok) fail(`${method}: ${result.description}`);
  return result.result;
}

type Step = { label: string; changed: boolean; run: () => Promise<void> };
const steps: Step[] = [];

/* ---- who --------------------------------------------------------- */

const me = await get<{ username: string; first_name: string; id: number }>('getMe');
console.log(`bot         @${me.username} (${me.first_name})`);
if (apiBase() !== 'https://api.telegram.org') console.log(`api base    ${apiBase()}`);

/* ---- webhook ------------------------------------------------------ */

const hook = await get<{
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
  max_connections?: number;
}>('getWebhookInfo');

console.log(`webhook     ${hook.url || '(none)'}`);
console.log(`pending     ${hook.pending_update_count} update(s)`);
if (hook.last_error_date) {
  console.log(
    `last error  ${new Date(hook.last_error_date * 1000).toISOString()} — ${hook.last_error_message ?? ''}`,
  );
}

const sameUrl = hook.url === URL_TARGET;
const sameUpdates =
  JSON.stringify([...(hook.allowed_updates ?? [])].sort()) ===
  JSON.stringify([...ALLOWED_UPDATES].sort());

if (hook.url && !sameUrl && !flag('--replace-webhook')) {
  console.log(
    `\n⚠ The webhook currently points at ${hook.url}.\n` +
      `  Replacing it would move this bot's traffic to ${URL_TARGET}.\n` +
      '  Pass --replace-webhook if that is what you want. Nothing about the webhook will change otherwise.',
  );
} else {
  steps.push({
    label: `webhook → ${URL_TARGET}, updates: ${ALLOWED_UPDATES.join(', ')}`,
    changed: !sameUrl || !sameUpdates || flag('--resend-secret'),
    run: async () => {
      await get('setWebhook', {
        url: URL_TARGET,
        secret_token: secret,
        allowed_updates: ALLOWED_UPDATES,
        max_connections: MAX_CONNECTIONS,
        // Never dropped: an update waiting in Telegram's queue is someone's
        // question.
        drop_pending_updates: false,
      });
    },
  });
}

/* ---- profile: name, descriptions, commands ----------------------- */

for (const lang of ['en', 'hi'] as const) {
  // English is registered as the default (no language_code), because it is
  // what every client not set to Hindi sees.
  const scope = lang === 'en' ? {} : { language_code: 'hi' };
  const tag = lang === 'en' ? 'default' : 'hi';

  const name = translate('brand.name', lang);
  const short = translate('tg.profile.short', lang);
  const description = translate('tg.profile.description', lang);
  const commands = commandMenu(lang);

  if (short.length > 120) fail(`short description (${tag}) is ${short.length} characters; Telegram allows 120.`);
  if (description.length > 512) fail(`description (${tag}) is ${description.length} characters; Telegram allows 512.`);

  const current = {
    name: (await get<{ name: string }>('getMyName', scope)).name,
    short: (await get<{ short_description: string }>('getMyShortDescription', scope)).short_description,
    description: (await get<{ description: string }>('getMyDescription', scope)).description,
    commands: await get<{ command: string; description: string }[]>('getMyCommands', scope),
  };

  steps.push(
    {
      label: `name (${tag}) → ${name}`,
      changed: current.name !== name,
      run: async () => void (await get('setMyName', { name, ...scope })),
    },
    {
      label: `short description (${tag})`,
      changed: current.short !== short,
      run: async () => void (await get('setMyShortDescription', { short_description: short, ...scope })),
    },
    {
      label: `description (${tag})`,
      changed: current.description !== description,
      run: async () => void (await get('setMyDescription', { description, ...scope })),
    },
    {
      label: `commands (${tag}) → ${commands.map((c) => `/${c.command}`).join(' ')}`,
      changed: JSON.stringify(current.commands) !== JSON.stringify(commands),
      run: async () => void (await get('setMyCommands', { commands, ...scope })),
    },
  );
}

/* ---- the plan ----------------------------------------------------- */

console.log('\nplan');
for (const step of steps) console.log(`  ${step.changed ? '•' : '✓'} ${step.label}${step.changed ? '' : '  (unchanged)'}`);
if (PHOTO) console.log(`  • profile photo ← ${AVATAR}`);
else console.log('  – profile photo: not touched (pass --photo to upload it)');

if (!APPLY) {
  console.log('\nRead-only. Nothing was changed. Run again with --apply to make the changes marked •.');
  process.exit(0);
}

/* ---- apply -------------------------------------------------------- */

console.log('\napplying');
for (const step of steps.filter((s) => s.changed)) {
  await step.run();
  console.log(`  ✓ ${step.label}`);
}

if (PHOTO) {
  if (!existsSync(AVATAR)) fail(`${AVATAR} is missing. Run node scripts/build-telegram-avatar.mjs.`);
  // setMyProfilePhoto (Bot API 9.4) takes a new upload every time, as
  // multipart: the photo field names the attached part.
  const form = new FormData();
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
  form.append('avatar', new Blob([readFileSync(AVATAR)], { type: 'image/jpeg' }), 'chaatak.jpg');
  const res = await fetch(`${apiBase()}/bot${process.env.TELEGRAM_BOT_TOKEN}/setMyProfilePhoto`, {
    method: 'POST',
    body: form,
  }).catch(() => null);
  const body = res ? ((await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }) : {};
  if (!res || !body.ok) fail(`setMyProfilePhoto: ${body.description ?? 'no response'}`);
  console.log('  ✓ profile photo');
}

const after = await get<{ url: string; pending_update_count: number }>('getWebhookInfo');
console.log(`\ndone. webhook ${after.url || '(none)'}, ${after.pending_update_count} pending.`);

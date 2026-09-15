import { type VercelConfig } from '@vercel/config/v1';

/**
 * Vercel project configuration.
 *
 * The alert daemon is a cron-driven endpoint rather than a long-running
 * process, because the platform has no long-running processes — and because an
 * endpoint is something you can curl twice and watch deduplicate, which is
 * worth more than a daemon you have to take on trust.
 *
 * ⚠ PLAN NOTE: minute-level cron needs Vercel Pro. On Hobby the shortest
 * interval is daily, which does not meet "poll every few minutes". The job is
 * just an authenticated endpoint, so any scheduler can drive it — a GitHub
 * Actions cron works on the free tier with no code change, only a different
 * caller. Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically;
 * anything else must send the same header.
 */
export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [
    {
      path: '/api/cron/warnings',
      // Every five minutes. A warning that takes an hour to reach someone is
      // not an early warning.
      schedule: '*/5 * * * *',
    },
  ],
};

export default config;

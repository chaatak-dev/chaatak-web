import { type VercelConfig } from '@vercel/config/v1';

// Vercel project configuration.
//
// ⚠ NO `crons` BLOCK HERE, DELIBERATELY. It declared a five-minute schedule,
// and on the Hobby plan Vercel rejects any cron more frequent than once a day
// — so every deployment from Phase 4 onwards failed, and production silently
// stayed on the Phase 3 build for three commits. The symptom was a 404 on
// /api/cron/warnings while the rest of the site served perfectly, because the
// live build simply predated the route.
//
// The alert daemon is scheduled by .github/workflows/poll-warnings.yml
// instead, which is why that workflow exists. The daemon is an authenticated
// endpoint and does not care who calls it.
//
// TO RESTORE VERCEL CRON ON PRO: add a `crons` entry pointing at
// /api/cron/warnings with the schedule you want, and delete the GitHub
// workflow. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
// automatically. Do not add it back while the project is on Hobby — it does
// not warn, it fails the deployment.
//
// (Line comments, not a block comment: a cron expression contains the
// characters that would close one.)
export const config: VercelConfig = {
  framework: 'nextjs',
};

export default config;

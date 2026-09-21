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

  /*
   * Run in Mumbai, next to the data.
   *
   * Vercel defaults functions to iad1 (Washington DC). Everything this app
   * talks to is in ap-south-1: Supabase Postgres, Supabase Auth, and IMD's
   * own gateway. Every query was therefore crossing the Atlantic and the
   * Indian Ocean twice.
   *
   * Measured, not assumed. From India the database answers a query in 25ms.
   * From iad1 the same query cost ~330ms, and opening a saved conversation —
   * one session check plus two queries, in sequence — took 1.3 SECONDS of
   * which almost all was distance.
   *
   * The audience is in India, the data is in India, so the compute is in
   * India. A single region is also all the Hobby plan allows, which happens
   * to be the right answer here rather than a compromise.
   */
  regions: ['bom1'],
};

export default config;

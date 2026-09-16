import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * The alert store reads migrations/001_alerts.sql at runtime through
   * `join(process.cwd(), ...)`. Next traces bundle contents by static
   * analysis, and a path built from process.cwd() cannot be resolved that way
   * — so the .sql file would be left out of the serverless bundle and the
   * cron endpoint would throw ENOENT on its first call in production, having
   * worked perfectly on every local run.
   *
   * Listing it here keeps migrations/001_alerts.sql as the single source of
   * truth for both the endpoint and scripts/migrate.mjs, rather than
   * duplicating the schema into a TypeScript string that could drift from it.
   */
  outputFileTracingIncludes: {
    '/api/cron/warnings': ['./migrations/**'],
    '/api/alerts/subscribe': ['./migrations/**'],
  },
};

export default nextConfig;

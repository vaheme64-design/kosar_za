import { defineConfig } from 'vitest/config';

/**
 * KPIMS backend tests run against a dedicated throwaway PostgreSQL database
 * (kpims_test on the same embedded instance). global-setup recreates it,
 * deploys migrations and seeds master data before any test executes.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://kpims:kpims_dev_local@127.0.0.1:5433/kpims_test?schema=public',
      JWT_SECRET: 'kpims-test-secret-0123456789abcdef',
    },
    // suites share one database — run files serially
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 180_000,
  },
});

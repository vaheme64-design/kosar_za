import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Recreates the throwaway test database (kpims_test), deploys all migrations
 * into it and seeds master data (units, sequences, permissions, demo parts).
 * Runs once before any test file.
 */
export async function setup(): Promise<void> {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // NOTE: never trust process.env.DATABASE_URL here — the host platform may
  // inject its own value. Tests always target the embedded KPIMS instance.
  const url =
    process.env.TEST_DATABASE_URL ??
    'postgresql://kpims:kpims_dev_local@127.0.0.1:5433/kpims_test?schema=public';
  const adminUrl = url.split('/').slice(0, -1).join('/') + '/postgres';

  const run = (cmd: string, env: NodeJS.ProcessEnv = {}) =>
    execSync(cmd, { cwd: backendDir, env: { ...process.env, ...env }, stdio: 'pipe' });

  // 1) drop + recreate the test database (connected to the maintenance db)
  for (const stmt of ['DROP DATABASE IF EXISTS kpims_test;', 'CREATE DATABASE kpims_test;']) {
    execSync(`npx prisma db execute --stdin --url "${adminUrl}"`, {
      cwd: backendDir,
      input: stmt,
      env: { ...process.env, DATABASE_URL: adminUrl },
      stdio: 'pipe',
    });
  }

  // 2) deploy migrations + 3) seed master data
  run('npx prisma migrate deploy', { DATABASE_URL: url });
  run('npx tsx prisma/seed.ts', { DATABASE_URL: url });

  console.log('[tests] kpims_test recreated, migrations deployed, seed applied');
}

#!/usr/bin/env node
/**
 * KPIMS — prisma CLI wrapper.
 *
 * Ensures the embedded PostgreSQL is running and that backend/.env values are
 * exported, then executes the real Prisma CLI inside backend/ with the correct
 * schema path.
 *
 *   node scripts/prisma.mjs migrate dev
 *   node scripts/prisma.mjs migrate deploy
 *   node scripts/prisma.mjs db seed
 *   node scripts/prisma.mjs studio
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(root, 'backend');
const prismaBin = path.join(backendDir, 'node_modules', '.bin', 'prisma');

function loadBackendEnv() {
  const envPath = path.join(backendDir, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('[prisma] backend/.env not found — run: node scripts/ensure-env.mjs');
    process.exit(1);
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: node scripts/prisma.mjs <prisma args...>');
    process.exit(1);
  }
  if (!fs.existsSync(prismaBin)) {
    console.error('[prisma] Prisma CLI not installed — run: cd backend && bun install');
    process.exit(1);
  }

  // make sure the database is reachable for migrate/seed commands
  if (!['--help', '--version', 'validate', 'format', 'generate'].some((a) => args.includes(a))) {
    spawnSync(process.execPath, [path.join(root, 'scripts', 'postgres.mjs'), 'start'], {
      cwd: root,
      stdio: 'inherit',
    });
  }

  const env = loadBackendEnv();
  const result = spawnSync(prismaBin, [...args, `--schema=prisma/schema.prisma`], {
    cwd: backendDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  process.exit(result.status ?? 1);
}

main();

#!/usr/bin/env node
/**
 * KPIMS — development orchestrator (used by .zscripts/dev.sh and `bun run dev`).
 *
 * Pipeline:
 *   1. ensure env files (backend/.env, frontend/.env.local)
 *   2. install dependencies (bun install; no-op when already synced)
 *   3. start embedded PostgreSQL (daemon; no-op when already running)
 *   4. apply pending Prisma migrations (migrate deploy — idempotent)
 *   5. seed demo master data (seed script is idempotent — skips when data exists)
 *   6. start Express API (port 4100) + Vite dev server (port 3000)
 */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_DIR = path.join(root, '.run');

const BACKEND_PORT = Number(process.env.BACKEND_PORT || 4100);
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3000);

const children = [];
let shuttingDown = false;

function log(...args) {
  console.log('[kpims-dev]', ...args);
}

function isPortOpen(port, host = '127.0.0.1', timeout = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killStaleService(name) {
  const pidFile = path.join(RUN_DIR, `${name}.pid`);
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (pid && pidAlive(pid)) {
    try {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (/node|tsx|vite/.test(cmdline)) {
        log(`stopping stale ${name} (pid ${pid})`);
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      /* process already gone */
    }
  }
  try {
    fs.unlinkSync(pidFile);
  } catch {
    /* ignore */
  }
}

function run(cmd, args, opts = {}) {
  log('$', cmd, ...args);
  execSync(`${cmd} ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
    cwd: root,
    stdio: 'inherit',
    ...opts,
  });
}

function spawnService(name, cmd, args, opts = {}) {
  log(`starting ${name}: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
    ...opts,
  });
  children.push(child);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUN_DIR, `${name}.pid`), String(child.pid));
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      log(`${name} exited unexpectedly (code=${code} signal=${signal}) — shutting down`);
      shutdown('child-exit');
    }
  });
  return child;
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down (${reason}) ...`);
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 800));
  for (const child of children) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}

async function main() {
  process.title = 'kpims-dev';
  console.log('==========================================================');
  console.log('  KPIMS — Kosar Production & Inventory Management System');
  console.log('  فاز صفر (اسکلت سامانه) + فاز یک (طرح دیتابیس)');
  console.log('==========================================================');

  // 1) env files
  run('node', ['scripts/ensure-env.mjs']);

  // 2) dependencies
  run('bun', ['install'], { cwd: root });
  run('bun', ['install'], { cwd: path.join(root, 'backend') });
  run('bun', ['install'], { cwd: path.join(root, 'frontend') });

  // 3) database
  run('node', ['scripts/postgres.mjs', 'start']);

  // 4) migrations
  run('node', ['scripts/prisma.mjs', 'migrate', 'deploy']);

  // 5) seed (idempotent)
  run('node', ['scripts/prisma.mjs', 'db', 'seed']);

  // 6) services
  killStaleService('backend');
  killStaleService('frontend');
  if (await isPortOpen(BACKEND_PORT)) {
    log(`warning: port ${BACKEND_PORT} is busy — assuming API already running`);
  } else {
    spawnService('backend', path.join(root, 'backend/node_modules/.bin/tsx'), [
      'watch',
      'src/server.ts',
    ], { cwd: path.join(root, 'backend') });
  }
  if (await isPortOpen(FRONTEND_PORT, '0.0.0.0')) {
    log(`warning: port ${FRONTEND_PORT} is busy — Vite will fail if it cannot bind; stopping`);
  } else {
    spawnService('frontend', path.join(root, 'frontend/node_modules/.bin/vite'), [
      '--host',
      '--port',
      String(FRONTEND_PORT),
      '--strictPort',
    ], { cwd: path.join(root, 'frontend') });
  }

  log(`API:      http://127.0.0.1:${BACKEND_PORT}/api/v1/health`);
  log(`Web UI:   http://127.0.0.1:${FRONTEND_PORT}/`);
  log('ready.');

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // keep alive
  setInterval(() => {}, 60_000);
}

main().catch((err) => {
  console.error('[kpims-dev] fatal:', err?.message || err);
  process.exit(1);
});

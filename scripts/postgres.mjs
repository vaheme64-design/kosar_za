#!/usr/bin/env node
/**
 * KPIMS — embedded PostgreSQL control script.
 *
 * The sandbox has no system PostgreSQL service, so KPIMS ships PostgreSQL 17
 * binaries (via the `embedded-postgres` npm package, binaries live inside
 * node_modules) that run as the current user with its data directory stored
 * under <project>/db/data.
 *
 * Commands:
 *   node scripts/postgres.mjs start    — initialise (first time) + start, waits until ready
 *   node scripts/postgres.mjs stop     — graceful stop
 *   node scripts/postgres.mjs status   — running or not
 *   node scripts/postgres.mjs serve    — (internal) run attached in foreground
 *
 * Environment overrides: PG_PORT (default 5433), PG_USER, PG_PASSWORD,
 * PG_DATABASE (default kpims), PG_DATA_DIR (default <project>/db/data).
 */
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PG_PORT = Number(process.env.PG_PORT || 5433);
const PG_USER = process.env.PG_USER || 'kpims';
const PG_PASSWORD = process.env.PG_PASSWORD || 'kpims_dev_local';
const PG_DATABASE = process.env.PG_DATABASE || 'kpims';
const PG_DATA_DIR = process.env.PG_DATA_DIR || path.join(root, 'db', 'data');
const RUN_DIR = path.join(root, '.run');
const PID_FILE = path.join(RUN_DIR, 'postgres.pid');
const LOG_FILE = path.join(RUN_DIR, 'postgres.log');

function isPortOpen(port, host = '127.0.0.1', timeout = 800) {
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

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startEmbedded() {
  // The module is imported lazily so that `status` works even before install.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: PG_DATA_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
  });
  if (!fs.existsSync(path.join(PG_DATA_DIR, 'PG_VERSION'))) {
    console.log(`[postgres] initialising cluster at ${PG_DATA_DIR} ...`);
    await pg.initialise();
  }
  console.log(`[postgres] starting PostgreSQL on port ${PG_PORT} ...`);
  await pg.start();
  try {
    await pg.createDatabase(PG_DATABASE);
    console.log(`[postgres] database "${PG_DATABASE}" created`);
  } catch (err) {
    if (!String(err?.message).includes('already exists')) throw err;
  }
  return pg;
}

async function serve() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  const pg = await startEmbedded();
  fs.writeFileSync(LOG_FILE, '');
  console.log(`[postgres] ready — port ${PG_PORT}, data dir ${PG_DATA_DIR}, pid ${process.pid}`);

  const shutdown = async (signal) => {
    console.log(`[postgres] received ${signal}, stopping ...`);
    try {
      await pg.stop();
    } catch (err) {
      console.error('[postgres] stop error:', err?.message || err);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  // keep the event loop alive
  setInterval(() => {}, 60_000);
}

async function main() {
  const cmd = process.argv[2] || 'status';
  if (cmd === 'serve') {
    await serve();
    return;
  }

  if (cmd === 'start') {
    if (await isPortOpen(PG_PORT)) {
      console.log(`[postgres] already running on port ${PG_PORT}`);
      return;
    }
    // daemonise: re-exec "serve" detached so this CLI can exit
    fs.mkdirSync(RUN_DIR, { recursive: true });
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', out, out],
      env: process.env,
    });
    child.unref();
    const ok = await waitForPort(PG_PORT, 180_000);
    if (!ok) {
      console.error(`[postgres] FAILED to become ready on port ${PG_PORT}; see ${LOG_FILE}`);
      process.exit(1);
    }
    console.log(`[postgres] running on port ${PG_PORT} (pid ${child.pid})`);
    return;
  }

  if (cmd === 'stop') {
    if (fs.existsSync(PID_FILE)) {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
      if (pidAlive(pid)) {
        process.kill(pid, 'SIGTERM');
        console.log(`[postgres] stop signal sent to pid ${pid}`);
        await waitForPort(PG_PORT, 30_000).then((stillOpen) => {
          if (stillOpen) console.warn('[postgres] warning: port still open after stop');
        });
        return;
      }
    }
    console.log('[postgres] not running (no live pid file)');
    return;
  }

  // status
  const running = await isPortOpen(PG_PORT);
  console.log(`[postgres] ${running ? 'RUNNING' : 'STOPPED'} (port ${PG_PORT})`);
  process.exit(running ? 0 : 1);
}

main().catch((err) => {
  console.error('[postgres] error:', err?.message || err);
  process.exit(1);
});

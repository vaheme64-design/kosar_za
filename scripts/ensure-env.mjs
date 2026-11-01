#!/usr/bin/env node
/**
 * KPIMS — ensure environment files exist.
 *
 * Creates backend/.env (and frontend/.env.local) from their examples if they
 * do not exist yet. A random JWT_SECRET is generated for development so the
 * server never starts with a hard-coded secret. In production, provide env
 * vars through the platform's Secrets manager instead of .env files.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnvFile(p, vars) {
  fs.writeFileSync(
    p,
    Object.entries(vars)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
    'utf8',
  );
}

// ---- backend/.env ----
const backendEnvPath = path.join(root, 'backend', '.env');
if (!fs.existsSync(backendEnvPath)) {
  const jwtSecret = crypto.randomBytes(48).toString('hex');
  writeEnvFile(backendEnvPath, {
    DATABASE_URL: 'postgresql://kpims:kpims_dev_local@127.0.0.1:5433/kpims?schema=public',
    PORT: '4100',
    NODE_ENV: 'development',
    CORS_ORIGIN: '*',
    JWT_SECRET: jwtSecret,
    JWT_ACCESS_TTL: '8h',
    BCRYPT_ROUNDS: '10',
    APP_TIMEZONE: 'Asia/Tehran',
  });
  console.log('[kpims] backend/.env created (JWT_SECRET generated randomly)');
} else {
  // make sure JWT_SECRET is present even if the file was hand-made
  const current = readEnvFile(backendEnvPath);
  if (!current.JWT_SECRET) {
    current.JWT_SECRET = crypto.randomBytes(48).toString('hex');
    writeEnvFile(backendEnvPath, current);
    console.log('[kpims] backend/.env: missing JWT_SECRET was generated');
  }
}

// ---- frontend/.env.local ----
const frontendEnvPath = path.join(root, 'frontend', '.env.local');
if (!fs.existsSync(frontendEnvPath)) {
  writeEnvFile(frontendEnvPath, {
    VITE_API_BASE_URL: '/api/v1',
    VITE_APP_TIMEZONE: 'Asia/Tehran',
    VITE_SHOW_DEMO_HINT: 'true',
  });
  console.log('[kpims] frontend/.env.local created');
}

console.log('[kpims] environment files are ready');

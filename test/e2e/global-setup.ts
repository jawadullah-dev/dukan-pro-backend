import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import bcrypt from 'bcrypt';
import {
  E2E_ADMIN_NAME,
  E2E_ADMIN_PASSWORD,
  E2E_ADMIN_PHONE,
  toE2eDatabaseUrl,
} from './e2e-env';

const ROOT = resolve(__dirname, '..', '..');

/**
 * Build the e2e database once, before any worker starts.
 *
 * Steps, in order:
 *   1. create the `<db>_e2e` database if it is missing;
 *   2. apply every migration (`prisma migrate deploy`);
 *   3. wipe all tenant rows and re-seed the platform admin.
 *
 * Step 3 makes repeated runs deterministic: suites provision their own shops
 * with unique phones, but a stale platform admin from an aborted run must never
 * shadow the freshly seeded one.
 */
export default async function globalSetup(): Promise<void> {
  delete process.env.NODE_ENV;
  loadEnv({ path: `.env.${process.env.E2E_ENV ?? 'development'}` });

  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error('DATABASE_URL is not set — cannot boot the e2e database');
  }

  const e2eUrl = toE2eDatabaseUrl(baseUrl);
  await ensureDatabase(baseUrl, e2eUrl);
  runMigrations(e2eUrl);
  await resetAndSeed(e2eUrl);
}

async function ensureDatabase(baseUrl: string, e2eUrl: string): Promise<void> {
  const target = new URL(e2eUrl).pathname.replace(/^\//, '');
  const maintenance = new URL(baseUrl);
  maintenance.pathname = '/postgres';

  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [target],
    );
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${target}"`);
    }
  } finally {
    await client.end();
  }
}

function runMigrations(e2eUrl: string): void {
  execFileSync(
    resolve(ROOT, 'node_modules', '.bin', 'prisma'),
    ['migrate', 'deploy'],
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: e2eUrl },
      stdio: 'pipe',
    },
  );
}

async function resetAndSeed(e2eUrl: string): Promise<void> {
  const client = new Client({ connectionString: e2eUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    const tables = rows.map((row) => `"${row.tablename}"`);
    if (tables.length > 0) {
      // TRUNCATE bypasses the row-level no-delete triggers (they fire on
      // DELETE, not TRUNCATE) — see prisma/constraints.sql.
      await client.query(
        `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
      );
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
    const passwordHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, rounds);
    await client.query(
      `INSERT INTO platform_admins
         (id, name, phone, password_hash, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, now(), now())
       ON CONFLICT (phone) DO UPDATE
         SET name = EXCLUDED.name,
             password_hash = EXCLUDED.password_hash,
             is_active = true,
             updated_at = now()`,
      [
        randomUUID(),
        E2E_ADMIN_NAME,
        normalizePhone(E2E_ADMIN_PHONE),
        passwordHash,
      ],
    );
  } finally {
    await client.end();
  }
}

const normalizePhone = (input: string): string => `92${input.slice(1)}`;

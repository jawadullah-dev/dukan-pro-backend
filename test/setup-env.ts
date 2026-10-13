import { config as loadEnv } from 'dotenv';
import { toE2eDatabaseUrl } from './e2e/e2e-env.js';

// Runs before the test file's imports, so ConfigModule sees the env vars.
// Jest forces NODE_ENV=test, but the app validates NODE_ENV against
// development/staging/production and its env files are named per environment,
// so drop Jest's value and let the chosen env file supply it.
delete process.env.NODE_ENV;
loadEnv({ path: `.env.${process.env.E2E_ENV ?? 'development'}` });

// Point the whole worker at the dedicated e2e database. ConfigModule reads
// process.env first, so this wins over the value loaded from the env file, and
// PrismaService (constructed from process.env.DATABASE_URL) connects here too.
process.env.DATABASE_URL = toE2eDatabaseUrl(process.env.DATABASE_URL);

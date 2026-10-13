import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer auto-loads .env files, so load the same file the app
// uses (see src/app-configuration/app-configuration.module.ts). Existing
// process.env values win, so CI/production env vars are not overridden.
loadEnv({ path: `.env.${process.env.NODE_ENV ?? 'development'}` });

export default defineConfig({
  // Multi-file schema: point at the DIRECTORY, not a single file, so every
  // `.prisma` under prisma/ (schema.prisma, enums.prisma, models/*.prisma) is loaded.
  schema: 'prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Read via process.env rather than prisma/config's env() helper: every CLI
    // command loads this file, and `prisma generate` must still work in CI
    // where DATABASE_URL is absent.
    url: process.env.DATABASE_URL ?? '',
  },
});
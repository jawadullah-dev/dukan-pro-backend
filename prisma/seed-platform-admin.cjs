/**
 * Creates (or resets) the local platform admin so you can log into Swagger.
 *
 * Platform admins cannot sign themselves up — an unauthenticated POST would let
 * anyone on the internet mint an HQ account. So the first admin has to be
 * inserted out-of-band, which is what this script is for.
 *
 * Local development only. Never point this at a shared or production database.
 *
 *   npm run seed:admin
 *
 * Reads SEED_ADMIN_PHONE / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME from the
 * environment, falling back to the local values.
 *
 * Written as CommonJS against `dist/` because the generated Prisma client is
 * TypeScript whose internal imports carry `.js` extensions — only the Nest
 * build resolves those. Hence the build step in the npm script.
 */
const net = require('net');
net.setDefaultAutoSelectFamily?.(false);

const path = require('path');
const dotenv = require('dotenv');

// Load environment files so DATABASE_URL and SEED_ADMIN_* are available
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const bcrypt = require('bcrypt');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client.js');
const { normalizePhone } = require('../dist/helpers/phone.helper.js');

const BCRYPT_ROUNDS = 10;

// Same pg adapter PrismaService uses. Prisma 7 requires one; it does not read
// DATABASE_URL by itself.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const phone = normalizePhone((process.env.SEED_ADMIN_PHONE || '03009999999').trim());
const name = (process.env.SEED_ADMIN_NAME || 'Dukaan Pro Support').trim();
const password = (process.env.SEED_ADMIN_PASSWORD || 'AdminOwner1').trim();

/**
 * A weak guard against `npm run seed:admin` aimed at the wrong database. Not a
 * security control — DATABASE_URL can say localhost and still be a tunnel. It
 * only catches the most likely mistake.
 */
function databaseLooksShared() {
  const url = process.env.DATABASE_URL || '';
  if (!url) return true;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

async function main() {
  const allowRemote =
    process.env.ALLOW_REMOTE_SEED === 'true' ||
    process.argv.includes('--force');

  if (databaseLooksShared() && !allowRemote) {
    throw new Error(
      'Refusing to seed: DATABASE_URL does not point at localhost.\n' +
        'If you intend to seed a live/remote database, set ALLOW_REMOTE_SEED=true or pass --force:\n' +
        '  ALLOW_REMOTE_SEED=true npm run seed:admin\n' +
        '  or: npm run seed:admin -- --force',
    );
  }

  if (!phone) {
    throw new Error(
      `SEED_ADMIN_PHONE "${
        process.env.SEED_ADMIN_PHONE
      }" is not a valid Pakistani mobile number.`,
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Upsert, not create: re-running resets the password instead of failing on
  // the unique index, which is what you want after forgetting the local one.
  const admin = await prisma.platformAdmin.upsert({
    where: { phone },
    update: { name, passwordHash, isActive: true },
    create: { name, phone, passwordHash, isActive: true },
  });

  console.log('Platform admin ready.');
  console.log(`  id:    ${admin.id}`);
  console.log(`  name:  ${admin.name}`);
  console.log(`  phone: ${admin.phone}`);
  console.log(`  pass:  ${password}`);
  console.log('');
  console.log('Log in at POST /auth/platform-admin/login');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
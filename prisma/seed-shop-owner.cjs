/**
 * Seeds a shop and shop owner for local or remote development/testing.
 *
 *   ALLOW_REMOTE_SEED=true npm run seed:owner
 *
 * Reads:
 *   SEED_OWNER_NAME (default: 'khalid')
 *   SEED_OWNER_PHONE (default: '03001234567')
 *   SEED_OWNER_PASSWORD (default: 'owner@123')
 *   SEED_SHOP_NAME (default: 'Khalid Mobile Shop')
 */
const net = require('net');
net.setDefaultAutoSelectFamily?.(false);

const path = require('path');
const dotenv = require('dotenv');

// Load environment files so DATABASE_URL and SEED_* are available
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const bcrypt = require('bcrypt');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client.js');
const { normalizePhone, normalizePhoneOrRaw } = require('../dist/helpers/phone.helper.js');
const {
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  WALK_IN_SUPPLIER,
} = require('../dist/platform-admin/constants/default-lists.constant.js');
const {
  storeSlugBase,
  nextFreeStoreSlug,
} = require('../dist/store/helpers/store-slug.helper.js');

const BCRYPT_ROUNDS = 10;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const rawPhone = process.env.SEED_OWNER_PHONE || '03001234567';
const phone = normalizePhone(rawPhone.trim());
const name = (process.env.SEED_OWNER_NAME || 'khalid').trim();
const password = (process.env.SEED_OWNER_PASSWORD || 'owner@123').trim();
const shopName = (process.env.SEED_SHOP_NAME || 'Khalid Mobile Shop').trim();

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
        '  ALLOW_REMOTE_SEED=true npm run seed:owner\n' +
        '  or: npm run seed:owner -- --force',
    );
  }

  if (!phone) {
    throw new Error(
      `SEED_OWNER_PHONE "${rawPhone}" is not a valid Pakistani mobile number.`,
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Check if owner already exists
  const existingUser = await prisma.user.findUnique({
    where: { phone },
    include: { shop: true },
  });

  let shop;
  let owner;

  if (existingUser) {
    owner = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        name,
        passwordHash,
        status: 'ACTIVE',
        role: 'OWNER',
      },
    });

    shop = await prisma.shop.update({
      where: { id: existingUser.shopId },
      data: {
        status: 'ACTIVE',
        subscriptionEndsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
  } else {
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const createdShop = await tx.shop.create({
        data: {
          name: shopName,
          phone: normalizePhoneOrRaw(rawPhone),
          address: 'Main Market',
          status: 'ACTIVE',
          subscriptionEndsAt: oneYearFromNow,
        },
      });

      const createdOwner = await tx.user.create({
        data: {
          shopId: createdShop.id,
          name,
          phone,
          passwordHash,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });

      if (DEFAULT_CATEGORIES && DEFAULT_CATEGORIES.length > 0) {
        await tx.category.createMany({
          data: DEFAULT_CATEGORIES.map((catName) => ({
            shopId: createdShop.id,
            name: catName,
          })),
        });
      }

      if (DEFAULT_EXPENSE_CATEGORIES && DEFAULT_EXPENSE_CATEGORIES.length > 0) {
        await tx.expenseCategory.createMany({
          data: DEFAULT_EXPENSE_CATEGORIES.map((expName) => ({
            shopId: createdShop.id,
            name: expName,
          })),
        });
      }

      await tx.supplier.create({
        data: {
          shopId: createdShop.id,
          name: WALK_IN_SUPPLIER.name,
          notes: WALK_IN_SUPPLIER.notes,
          isSystem: WALK_IN_SUPPLIER.isSystem,
        },
      });

      const storeSlug = await nextFreeStoreSlug(
        storeSlugBase(createdShop.name, createdShop.id),
        async (candidate) =>
          Boolean(
            await tx.shopStoreSettings.findUnique({
              where: { slug: candidate },
              select: { slug: true },
            }),
          ),
      );

      await tx.shopStoreSettings.create({
        data: {
          shopId: createdShop.id,
          slug: storeSlug,
          isEnabled: false,
          displayName: createdShop.name.trim().slice(0, 100),
          phoneNumber: createdShop.phone,
          address: createdShop.address,
        },
      });

      return { shop: createdShop, owner: createdOwner };
    });

    shop = result.shop;
    owner = result.owner;
  }

  console.log('Shop owner ready.');
  console.log(`  Shop ID:    ${shop.id}`);
  console.log(`  Shop Name:  ${shop.name}`);
  console.log(`  Owner ID:   ${owner.id}`);
  console.log(`  Owner Name: ${owner.name}`);
  console.log(`  Phone:      ${owner.phone} (${rawPhone})`);
  console.log(`  Password:   ${password}`);
  console.log(`  Role:       ${owner.role}`);
  console.log('');
  console.log('Log in at POST /auth/login with phone & password');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });


/**
 * Seeds the complete end-to-end business flow for Dukan Pro:
 *  1. Shop & Owner (Multi-tenant root + Store settings)
 *  2. Categories & Brands
 *  3. Products (Serialized Phone + Quantity Accessory)
 *  4. Cash Drawer Opening Balance
 *  5. Wholesale Supplier & Purchase Invoice (Stock-In)
 *     - Serialized Phone IMEI Units (IN_STOCK)
 *     - Quantity Accessory StockLevel + Movements
 *     - Supplier Payment & Cash Out
 *  6. Customer & POS Sale
 *     - Sale Invoice with SaleItems
 *     - Inventory deduction
 *     - Customer Payment & Cash In
 *  7. Shop Operating Expense
 *     - Expense row + Cash Out
 *
 * 100% IDEMPOTENT: Safe to run repeatedly without duplicate errors.
 *
 * Usage:
 *   ALLOW_REMOTE_SEED=true npm run seed:catalog
 */
const net = require('net');
net.setDefaultAutoSelectFamily?.(false);

const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables (.env.development and .env)
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
      'Refusing to seed: DATABASE_URL points to a remote/shared database.\n' +
        'If you intend to seed this database, set ALLOW_REMOTE_SEED=true or pass --force:\n' +
        '  ALLOW_REMOTE_SEED=true npm run seed:catalog\n' +
        '  or: npm run seed:catalog -- --force',
    );
  }

  if (!phone) {
    throw new Error(`SEED_OWNER_PHONE "${rawPhone}" is not a valid Pakistani mobile number.`);
  }

  // =========================================================================
  // STEP 1: Shop & Shop Owner (WF1 & WF2)
  // =========================================================================
  console.log('=== Step 1: Shop & Owner ===');
  let user = await prisma.user.findUnique({
    where: { phone },
    include: { shop: true },
  });

  let shop;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  if (!user) {
    shop = await prisma.shop.create({
      data: {
        name: shopName,
        phone: normalizePhoneOrRaw(rawPhone),
        address: 'Main Market, Gulberg, Lahore',
        status: 'ACTIVE',
        subscriptionEndsAt: oneYearFromNow,
      },
    });

    user = await prisma.user.create({
      data: {
        shopId: shop.id,
        name,
        phone,
        passwordHash,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    // Default categories & expense categories
    if (DEFAULT_CATEGORIES && DEFAULT_CATEGORIES.length > 0) {
      await prisma.category.createMany({
        data: DEFAULT_CATEGORIES.map((catName) => ({
          shopId: shop.id,
          name: catName,
        })),
        skipDuplicates: true,
      });
    }

    if (DEFAULT_EXPENSE_CATEGORIES && DEFAULT_EXPENSE_CATEGORIES.length > 0) {
      await prisma.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((expName) => ({
          shopId: shop.id,
          name: expName,
        })),
        skipDuplicates: true,
      });
    }

    await prisma.supplier.create({
      data: {
        shopId: shop.id,
        name: WALK_IN_SUPPLIER.name,
        notes: WALK_IN_SUPPLIER.notes,
        isSystem: WALK_IN_SUPPLIER.isSystem,
      },
    });

    const storeSlug = await nextFreeStoreSlug(
      storeSlugBase(shop.name, shop.id),
      async (candidate) =>
        Boolean(
          await prisma.shopStoreSettings.findUnique({
            where: { slug: candidate },
            select: { slug: true },
          }),
        ),
    );

    await prisma.shopStoreSettings.create({
      data: {
        shopId: shop.id,
        slug: storeSlug,
        isEnabled: true,
        displayName: shop.name.trim().slice(0, 100),
        phoneNumber: shop.phone,
        address: shop.address,
      },
    });
    console.log(`✓ Created Shop: "${shop.name}" and Owner: "${user.name}"`);
  } else {
    shop = user.shop;
    console.log(`✓ Existing Shop: "${shop.name}" and Owner: "${user.name}"`);
  }

  // =========================================================================
  // STEP 2: Categories & Brands (WF4)
  // =========================================================================
  console.log('\n=== Step 2: Categories & Brands ===');
  const catPhones = await prisma.category.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'Mobile Phones' } },
    update: { isActive: true },
    create: { shopId: shop.id, name: 'Mobile Phones', isActive: true },
  });

  const catAccessories = await prisma.category.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'Accessories' } },
    update: { isActive: true },
    create: { shopId: shop.id, name: 'Accessories', isActive: true },
  });

  const brandApple = await prisma.brand.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'Apple' } },
    update: { isActive: true },
    create: { shopId: shop.id, name: 'Apple', isActive: true },
  });

  const brandSamsung = await prisma.brand.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'Samsung' } },
    update: { isActive: true },
    create: { shopId: shop.id, name: 'Samsung', isActive: true },
  });
  console.log(`✓ Categories: ${catPhones.name}, ${catAccessories.name}`);
  console.log(`✓ Brands: ${brandApple.name}, ${brandSamsung.name}`);

  // =========================================================================
  // STEP 3: Products (WF4)
  // =========================================================================
  console.log('\n=== Step 3: Products ===');
  // Serialized Phone (iPhone 15 Pro)
  const phoneProduct = await prisma.product.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'iPhone 15 Pro 128GB' } },
    update: {
      isActive: true,
      defaultPurchasePrice: 28000000n, // Rs 280,000 in Paisa
      defaultSellingPrice: 31000000n,  // Rs 310,000 in Paisa
    },
    create: {
      shopId: shop.id,
      categoryId: catPhones.id,
      brandId: brandApple.id,
      name: 'iPhone 15 Pro 128GB',
      trackingType: 'SERIALIZED',
      model: 'iPhone 15 Pro',
      color: 'Natural Titanium',
      storage: '128GB',
      sku: 'IPHONE-15P-128-NAT',
      barcode: '195949000001',
      description: 'Apple iPhone 15 Pro 128GB Natural Titanium',
      publicDescription: 'A17 Pro chip, Titanium design with textured matte glass back, 48MP main camera.',
      defaultPurchasePrice: 28000000n,
      defaultSellingPrice: 31000000n,
      lowStockThreshold: 2,
      isActive: true,
      isPublished: true,
      ptaStatus: 'PTA_APPROVED',
    },
  });

  // Quantity Accessory (20W USB-C Adapter)
  const adapterProduct = await prisma.product.upsert({
    where: { shopId_name: { shopId: shop.id, name: 'Apple 20W USB-C Power Adapter' } },
    update: {
      isActive: true,
      defaultPurchasePrice: 450000n, // Rs 4,500 in Paisa
      defaultSellingPrice: 650000n,  // Rs 6,500 in Paisa
    },
    create: {
      shopId: shop.id,
      categoryId: catAccessories.id,
      brandId: brandApple.id,
      name: 'Apple 20W USB-C Power Adapter',
      trackingType: 'QUANTITY',
      model: '20W Adapter',
      sku: 'APPLE-20W-ADAPTER',
      barcode: '195949000002',
      description: 'Original Apple 20W USB-C Power Adapter',
      publicDescription: 'Fast, efficient charging at home, in the office, or on the go.',
      defaultPurchasePrice: 450000n,
      defaultSellingPrice: 650000n,
      lowStockThreshold: 5,
      isActive: true,
      isPublished: true,
    },
  });
  console.log(`✓ Products created: ${phoneProduct.name} (SERIALIZED), ${adapterProduct.name} (QUANTITY)`);

  // =========================================================================
  // STEP 4: Opening Cash in Drawer (WF1 & WF16)
  // =========================================================================
  console.log('\n=== Step 4: Cash Drawer Opening Balance ===');
  const existingOpeningCash = await prisma.cashMovement.findFirst({
    where: { shopId: shop.id, type: 'OPENING_CASH' },
  });

  if (!existingOpeningCash) {
    await prisma.cashMovement.create({
      data: {
        shopId: shop.id,
        type: 'OPENING_CASH',
        direction: 'IN',
        amount: 5000000n, // Rs 50,000 in Paisa
        movementDate: new Date(),
        referenceType: null,
        referenceId: null,
        note: 'Opening float in cash drawer',
        createdById: user.id,
      },
    });
    console.log('✓ Initialized Cash Drawer Float: Rs 50,000');
  } else {
    console.log('✓ Cash drawer opening float already initialized');
  }

  // =========================================================================
  // STEP 5: Wholesale Supplier & Stock-In Purchase (WF5 & WF6)
  // =========================================================================
  console.log('\n=== Step 5: Supplier & Purchase (Stock-In) ===');
  let wholesaleSupplier = await prisma.supplier.findFirst({
    where: { shopId: shop.id, name: 'Ali Wholesale Telecom' },
  });

  if (!wholesaleSupplier) {
    wholesaleSupplier = await prisma.supplier.create({
      data: {
        shopId: shop.id,
        name: 'Ali Wholesale Telecom',
        phone: '03011112222',
        address: 'Hall Road, Lahore',
        notes: 'Main wholesale distributor for Apple & Samsung products',
        isSystem: false,
      },
    });
    console.log(`✓ Created Supplier: ${wholesaleSupplier.name}`);
  } else {
    console.log(`✓ Found Supplier: ${wholesaleSupplier.name}`);
  }

  // Check if purchase P-0001 already exists
  let purchase = await prisma.purchase.findUnique({
    where: { shopId_purchaseNo: { shopId: shop.id, purchaseNo: 'P-0001' } },
    include: { items: true },
  });

  if (!purchase) {
    const totalAmount = (2n * 28000000n) + (25n * 450000n); // 2 iPhones + 25 Adapters = Rs 672,500
    const purchaseReqId = crypto.randomUUID();

    purchase = await prisma.purchase.create({
      data: {
        shopId: shop.id,
        supplierId: wholesaleSupplier.id,
        purchaseNo: 'P-0001',
        supplierInvoiceRef: 'INV-2026-9901',
        purchaseDate: new Date(),
        totalAmount,
        status: 'ACTIVE',
        clientRequestId: purchaseReqId,
        notes: 'Initial stock intake from Hall Road distributor',
        createdById: user.id,
      },
      include: { items: true },
    });

    // Purchase Item 1: 2x iPhone 15 Pro
    const purchaseItemPhone = await prisma.purchaseItem.create({
      data: {
        shopId: shop.id,
        purchaseId: purchase.id,
        productId: phoneProduct.id,
        quantity: 2,
        unitCost: 28000000n,
        totalCost: 2n * 28000000n,
      },
    });

    // Purchase Item 2: 25x 20W Adapters
    const purchaseItemAdapter = await prisma.purchaseItem.create({
      data: {
        shopId: shop.id,
        purchaseId: purchase.id,
        productId: adapterProduct.id,
        quantity: 25,
        unitCost: 450000n,
        totalCost: 25n * 450000n,
      },
    });

    // Bring in 2 physical IMEI phone units (SERIALIZED)
    const imeiList = ['354892091234561', '354892091234562'];
    for (const imei of imeiList) {
      const unit = await prisma.inventoryUnit.create({
        data: {
          shopId: shop.id,
          productId: phoneProduct.id,
          purchaseItemId: purchaseItemPhone.id,
          imei1: imei,
          condition: 'NEW',
          unitCost: 28000000n,
          status: 'IN_STOCK',
        },
      });

      await prisma.inventoryMovement.create({
        data: {
          shopId: shop.id,
          productId: phoneProduct.id,
          inventoryUnitId: unit.id,
          type: 'PURCHASE',
          quantityChange: 1,
          referenceType: 'PURCHASE',
          referenceId: purchase.id,
        },
      });
    }

    // Set initial StockLevel for QUANTITY adapters
    await prisma.stockLevel.upsert({
      where: { productId: adapterProduct.id },
      update: {
        quantityOnHand: 25,
        avgUnitCost: 450000n,
      },
      create: {
        productId: adapterProduct.id,
        shopId: shop.id,
        quantityOnHand: 25,
        avgUnitCost: 450000n,
      },
    });

    await prisma.inventoryMovement.create({
      data: {
        shopId: shop.id,
        productId: adapterProduct.id,
        type: 'PURCHASE',
        quantityChange: 25,
        referenceType: 'PURCHASE',
        referenceId: purchase.id,
      },
    });

    // Record Partial Supplier Payment (Rs 100,000 paid in cash, rest on credit/Udhar)
    const paymentAmount = 10000000n; // Rs 100,000
    const supplierPayment = await prisma.supplierPayment.create({
      data: {
        shopId: shop.id,
        supplierId: wholesaleSupplier.id,
        purchaseId: purchase.id,
        amount: paymentAmount,
        paymentDate: new Date(),
        status: 'ACTIVE',
        notes: 'Advance cash payment against invoice INV-2026-9901',
        createdById: user.id,
      },
    });

    await prisma.cashMovement.create({
      data: {
        shopId: shop.id,
        type: 'SUPPLIER_PAYMENT',
        direction: 'OUT',
        amount: paymentAmount,
        movementDate: new Date(),
        referenceType: 'SUPPLIER_PAYMENT',
        referenceId: supplierPayment.id,
        note: `Paid ${wholesaleSupplier.name} against purchase P-0001`,
        createdById: user.id,
      },
    });

    console.log(`✓ Purchase P-0001 created: 2x iPhones (IMEIs: ${imeiList.join(', ')}), 25x Adapters`);
    console.log(`✓ Paid Rs 100,000 cash to ${wholesaleSupplier.name}`);
  } else {
    console.log('✓ Purchase P-0001 and inventory units already present');
  }

  // =========================================================================
  // STEP 6: Customer & Sale / POS Flow (WF9 & WF10)
  // =========================================================================
  console.log('\n=== Step 6: Customer & POS Sale ===');
  let customer = await prisma.customer.findFirst({
    where: { shopId: shop.id, name: 'Ahmed Khan' },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: 'Ahmed Khan',
        phone: '03123456789',
        address: 'DHA Phase 5, Lahore',
        notes: 'Regular retail customer',
        openingBalance: 0n,
        isActive: true,
      },
    });
    console.log(`✓ Created Customer: "${customer.name}" (${customer.phone})`);
  } else {
    console.log(`✓ Found Customer: "${customer.name}"`);
  }

  let sale = await prisma.sale.findUnique({
    where: { shopId_saleNo: { shopId: shop.id, saleNo: 'S-0001' } },
  });

  if (!sale) {
    const salePrice = 650000n; // Rs 6,500
    const saleCost = 450000n;  // Rs 4,500
    const saleReqId = crypto.randomUUID();

    sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        customerId: customer.id,
        saleNo: 'S-0001',
        saleDate: new Date(),
        subtotal: salePrice,
        discount: 0n,
        totalAmount: salePrice,
        status: 'ACTIVE',
        clientRequestId: saleReqId,
        notes: 'Counter POS sale - Apple 20W Adapter',
        createdById: user.id,
      },
    });

    await prisma.saleItem.create({
      data: {
        shopId: shop.id,
        saleId: sale.id,
        productId: adapterProduct.id,
        quantity: 1,
        unitPrice: salePrice,
        unitCost: saleCost,
        total: salePrice,
      },
    });

    // Deduct stock for quantity product
    await prisma.stockLevel.update({
      where: { productId: adapterProduct.id },
      data: {
        quantityOnHand: { decrement: 1 }, // 25 -> 24
      },
    });

    await prisma.inventoryMovement.create({
      data: {
        shopId: shop.id,
        productId: adapterProduct.id,
        type: 'SALE',
        quantityChange: -1,
        referenceType: 'SALE',
        referenceId: sale.id,
      },
    });

    // Full Cash Payment by customer
    const payment = await prisma.payment.create({
      data: {
        shopId: shop.id,
        customerId: customer.id,
        saleId: sale.id,
        amount: salePrice,
        paymentDate: new Date(),
        method: 'CASH',
        status: 'ACTIVE',
        clientRequestId: crypto.randomUUID(),
        notes: 'Paid in full cash at counter',
        createdById: user.id,
      },
    });

    await prisma.cashMovement.create({
      data: {
        shopId: shop.id,
        type: 'CUSTOMER_PAYMENT',
        direction: 'IN',
        amount: salePrice,
        movementDate: new Date(),
        referenceType: 'PAYMENT',
        referenceId: payment.id,
        note: `Cash received from ${customer.name} for Sale S-0001`,
        createdById: user.id,
      },
    });

    console.log(`✓ Sale S-0001 created: 1x 20W Adapter sold to ${customer.name} for Rs 6,500`);
    console.log(`✓ Adapter stock reduced to 24 units, Rs 6,500 received in Cash`);
  } else {
    console.log('✓ Sale S-0001 already recorded');
  }

  // =========================================================================
  // STEP 7: Operating Expense Flow (WF13)
  // =========================================================================
  console.log('\n=== Step 7: Shop Expense ===');
  const catInternet = await prisma.expenseCategory.findFirst({
    where: { shopId: shop.id, name: 'Internet' },
  });

  const existingExpense = await prisma.expense.findFirst({
    where: { shopId: shop.id, description: 'PTCL Flash Fiber Bill' },
  });

  if (!existingExpense && catInternet) {
    const expenseAmount = 250000n; // Rs 2,500
    const expense = await prisma.expense.create({
      data: {
        shopId: shop.id,
        categoryId: catInternet.id,
        amount: expenseAmount,
        expenseDate: new Date(),
        description: 'PTCL Flash Fiber Bill',
        status: 'ACTIVE',
        createdById: user.id,
      },
    });

    await prisma.cashMovement.create({
      data: {
        shopId: shop.id,
        type: 'EXPENSE',
        direction: 'OUT',
        amount: expenseAmount,
        movementDate: new Date(),
        referenceType: 'EXPENSE',
        referenceId: expense.id,
        note: 'PTCL Internet monthly payment',
        createdById: user.id,
      },
    });
    console.log('✓ Logged Expense: Rs 2,500 for Internet');
  } else {
    console.log('✓ Operating expense already recorded');
  }

  console.log('\n======================================================');
  console.log('✓ COMPLETE END-TO-END FLOW SEEDED SUCCESSFULLY!');
  console.log('======================================================');
  console.log(`Shop:      ${shop.name} (${shop.id})`);
  console.log(`Login:     Phone: ${user.phone}  |  Password: ${password}`);
  console.log(`Store:     Slug: khalid-mobile-shop (Enabled)`);
  console.log('Data summary:');
  console.log('  - 2 Categories (Mobile Phones, Accessories)');
  console.log('  - 2 Brands (Apple, Samsung)');
  console.log('  - 2 Products (iPhone 15 Pro, 20W Power Adapter)');
  console.log('  - 2 In-Stock Phone Units (IMEI: 354892091234561, 354892091234562)');
  console.log('  - 24 In-Stock Quantity Adapters');
  console.log('  - 1 Wholesale Supplier (Ali Wholesale Telecom)');
  console.log('  - 1 Purchase Order (P-0001 with supplier invoice INV-2026-9901)');
  console.log('  - 1 Customer (Ahmed Khan)');
  console.log('  - 1 POS Sale (S-0001, Rs 6,500 cash received)');
  console.log('  - 1 Expense (Rs 2,500 for PTCL Internet)');
  console.log('  - Balanced Cash Movements in drawer');
  console.log('======================================================');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });

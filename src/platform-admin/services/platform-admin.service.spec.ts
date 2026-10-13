import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ShopStatus } from '../../generated/prisma/enums.js';
import { AuthService } from '../../auth/services/auth.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PlatformAdminService } from './platform-admin.service.js';
import {
  DEFAULT_BRANDS,
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  WALK_IN_SUPPLIER,
} from '../constants/default-lists.constant.js';

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
  });

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

/**
 * Collects every write the service makes so a test can assert on the whole
 * transaction at once — that is the only way to prove the shop, owner, defaults
 * and setup token are all written inside ONE transaction.
 */
const txCalls: string[] = [];
const resetTxCalls = (): void => {
  txCalls.length = 0;
};

const txStub = {
  shop: {
    create: jest.fn(({ data }: any) => {
      txCalls.push('shop.create');
      return {
        id: 'shop-1',
        name: data.name,
        status: ShopStatus.ACTIVE,
        nextSaleNo: 1,
        nextPurchaseNo: 1,
        phone: data.phone ?? null,
        address: data.address ?? null,
      };
    }),
  },
  shopStoreSettings: {
    findUnique: jest.fn(() => null),
    create: jest.fn(({ data }: any) => {
      txCalls.push('shopStoreSettings.create');
      return { shopId: data.shopId, ...data };
    }),
  },
  user: {
    create: jest.fn(({ data }: any) => {
      txCalls.push('user.create');
      return { id: 'user-1', shopId: data.shopId, ...data };
    }),
    update: jest.fn(({ data }: any) => {
      txCalls.push('user.update:setupToken');
      return { id: 'user-1', ...data };
    }),
    findUnique: jest.fn(),
  },
  category: {
    createMany: jest.fn(({ data }: any) => {
      txCalls.push(`category.createMany:${data.length}`);
      return { count: data.length };
    }),
  },
  brand: {
    createMany: jest.fn(({ data }: any) => {
      txCalls.push(`brand.createMany:${data.length}`);
      return { count: data.length };
    }),
  },
  expenseCategory: {
    createMany: jest.fn(({ data }: any) => {
      txCalls.push(`expenseCategory.createMany:${data.length}`);
      return { count: data.length };
    }),
  },
  supplier: {
    create: jest.fn(({ data }: any) => {
      txCalls.push('supplier.create');
      return { id: 'supplier-1', ...data };
    }),
  },
};

const prismaStub = {
  shop: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn((cb: any) => cb(txStub)),
};

const authStub = {
  buildSetupLink: jest.fn(() => ({
    setupUrl: 'http://localhost:3000/setup-password?token=abc123',
    expiresAt: new Date(Date.now() + 86_400_000),
  })),
};

const storeStub = {
  changeStoreSlug: jest.fn(() => ({
    status: true,
    message: 'Store slug updated to "new-address"',
  })),
};

const validDto = {
  shopName: '  Khalid Mobile Center  ',
  shopPhone: '03001234567',
  shopAddress: 'Main Bazaar',
  subscriptionEndsAt: FUTURE,
  ownerName: '  Khalid Mehmood  ',
  ownerPhone: '03001234567',
};

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    resetTxCalls();
    prismaStub.user.findUnique.mockResolvedValue(null);
    service = new PlatformAdminService(
      prismaStub as unknown as PrismaService,
      authStub as unknown as AuthService,
      storeStub as any,
    );
  });

  describe('createShop', () => {
    it('trims the shop and owner names', async () => {
      const res = await service.createShop(validDto);

      expect(txStub.shop.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Khalid Mobile Center',
          }),
        }),
      );
      expect(res.shopName).toBe('Khalid Mobile Center');
      expect(res.ownerName).toBe('Khalid Mehmood');
    });

    it('normalises the owner phone to E.164 without +', async () => {
      const res = await service.createShop(validDto);

      expect(txStub.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ phone: '923001234567' }),
        }),
      );
      expect(res.ownerPhone).toBe('923001234567');
    });

    it('creates the owner with no password so the owner chooses it', async () => {
      await service.createShop(validDto);

      expect(txStub.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: null }),
        }),
      );
    });

    it('starts both automatic counters at 1', async () => {
      const res = await service.createShop(validDto);

      expect(res.counters).toEqual({ nextSaleNo: 1, nextPurchaseNo: 1 });
    });

    it('rejects a subscription that already ended', async () => {
      await expect(
        service.createShop({ ...validDto, subscriptionEndsAt: PAST }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an unparseable phone without touching the database', async () => {
      await expect(
        service.createShop({ ...validDto, ownerPhone: '123' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaStub.user.findUnique).not.toHaveBeenCalled();
    });

    it('does not call an unparseable phone "already registered"', async () => {
      // Different faults need different fixes for the admin: one needs a
      // corrected number, the other needs a different shop.
      await expect(
        service.createShop({ ...validDto, ownerPhone: '123' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'That is not a valid phone number',
        }),
      });
    });

    it('rejects an unparseable subscription date', async () => {
      await expect(
        service.createShop({ ...validDto, subscriptionEndsAt: 'not-a-date' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: 'Subscription end date is not a valid date',
        }),
      });
    });

    it('refuses a phone that already owns another shop', async () => {
      prismaStub.user.findUnique.mockResolvedValue({
        shop: { name: 'Other Shop' },
      });

      await expect(service.createShop(validDto)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('turns a concurrent duplicate phone into a friendly 400', async () => {
      // Two admins race: both pass the pre-check, then the unique index on
      // users.phone rejects the loser. P2002 is the real guarantee.
      prismaStub.$transaction.mockRejectedValueOnce(uniqueViolation());

      await expect(service.createShop(validDto)).rejects.toMatchObject({
        status: 400,
      });
    });

    it('copies the default lists per shop', async () => {
      const res = await service.createShop(validDto);

      expect(txStub.category.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          { shopId: 'shop-1', name: 'Mobile Phones' },
        ]),
      });
      expect(res.defaults.categories).toBe(DEFAULT_CATEGORIES.length);
      expect(res.defaults.expenseCategories).toBe(
        DEFAULT_EXPENSE_CATEGORIES.length,
      );
    });

    it('gives every copied row the new shop id', async () => {
      await service.createShop(validDto);

      const categories = txStub.category.createMany.mock.calls[0][0].data;
      expect(categories.every((c: any) => c.shopId === 'shop-1')).toBe(true);
    });

    it('seeds no brands, so the owner types their own', async () => {
      const res = await service.createShop(validDto);

      expect(DEFAULT_BRANDS).toHaveLength(0);
      expect(txStub.brand.createMany).not.toHaveBeenCalled();
      expect(res.defaults.brands).toBe(0);
    });

    it('creates the protected Walk-in seller supplier', async () => {
      await service.createShop(validDto);

      expect(txStub.supplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopId: 'shop-1',
            name: WALK_IN_SUPPLIER.name,
            isSystem: true,
          }),
        }),
      );
    });

    it('mints the setup token through AuthService, on the transaction client', async () => {
      const res = await service.createShop(validDto);

      // The tx client is the second argument on purpose: the owner row is still
      // uncommitted, so the main Prisma client cannot see it yet.
      expect(authStub.buildSetupLink).toHaveBeenCalledWith('user-1', txStub);
      expect(res.setupUrl).toContain('/setup-password?token=');
    });

    it('writes shop, owner, defaults and supplier in ONE transaction', async () => {
      await service.createShop(validDto);

      expect(prismaStub.$transaction).toHaveBeenCalledTimes(1);
      expect(txCalls).toEqual([
        'shop.create',
        'user.create',
        `category.createMany:${DEFAULT_CATEGORIES.length}`,
        `expenseCategory.createMany:${DEFAULT_EXPENSE_CATEGORIES.length}`,
        'supplier.create',
        // WF19 step 1: the store row is born with the shop (OFF).
        'shopStoreSettings.create',
      ]);
    });

    it('gives the new shop a disabled store row with a derived slug', async () => {
      await service.createShop(validDto);

      expect(txStub.shopStoreSettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: 'shop-1',
          slug: 'khalid-mobile-center',
          displayName: 'Khalid Mobile Center',
          isEnabled: false,
        }),
      });
    });

    it('reports what it copied back to the admin', async () => {
      const res = await service.createShop(validDto);

      expect(res.defaults).toEqual({
        categories: DEFAULT_CATEGORIES.length,
        brands: 0,
        expenseCategories: DEFAULT_EXPENSE_CATEGORIES.length,
        suppliers: 1,
      });
      expect(res.status).toBe(ShopStatus.ACTIVE);
    });
  });

  describe('updateSubscription', () => {
    const activeShop = {
      id: 'shop-1',
      name: 'Khalid Mobile Center',
      status: ShopStatus.ACTIVE,
      subscriptionEndsAt: new Date(Date.now() + 86_400_000),
    };

    it('extends the subscription date', async () => {
      prismaStub.shop.findUnique.mockResolvedValue(activeShop);
      prismaStub.shop.update.mockResolvedValue({
        ...activeShop,
        subscriptionEndsAt: new Date(Date.now() + 60 * 86_400_000),
      });

      const res = await service.updateSubscription('shop-1', {
        subscriptionEndsAt: new Date(
          Date.now() + 60 * 86_400_000,
        ).toISOString(),
      });

      expect(prismaStub.shop.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            subscriptionEndsAt: expect.any(Date),
            status: ShopStatus.ACTIVE,
          },
        }),
      );
      expect(res.isAccessible).toBe(true);
    });

    it('suspends immediately when isActive is false', async () => {
      prismaStub.shop.findUnique.mockResolvedValue(activeShop);
      prismaStub.shop.update.mockResolvedValue({
        ...activeShop,
        status: ShopStatus.SUSPENDED,
      });

      const res = await service.updateSubscription('shop-1', {
        isActive: false,
      });

      expect(prismaStub.shop.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: ShopStatus.SUSPENDED },
        }),
      );
      expect(res.isAccessible).toBe(false);
    });

    it('reports a shop with an expired date as inaccessible even while ACTIVE', async () => {
      prismaStub.shop.findUnique.mockResolvedValue(activeShop);
      prismaStub.shop.update.mockResolvedValue({
        ...activeShop,
        subscriptionEndsAt: new Date(Date.now() - 1000),
      });

      const res = await service.updateSubscription('shop-1', {
        subscriptionEndsAt: FUTURE,
      });

      expect(res.isAccessible).toBe(false);
    });

    it('404s for a shop that does not exist', async () => {
      prismaStub.shop.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSubscription('shop-1', { isActive: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an empty update instead of silently doing nothing', async () => {
      prismaStub.shop.findUnique.mockResolvedValue(activeShop);

      await expect(service.updateSubscription('shop-1', {})).rejects.toThrow(
        /Nothing to update/,
      );
      expect(prismaStub.shop.update).not.toHaveBeenCalled();
    });

    it('refuses to "renew" to a date already in the past', async () => {
      prismaStub.shop.findUnique.mockResolvedValue(activeShop);

      await expect(
        service.updateSubscription('shop-1', { subscriptionEndsAt: PAST }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.shop.update).not.toHaveBeenCalled();
    });
  });

  describe('getShopOwner', () => {
    it('says the owner has not set a password yet', async () => {
      prismaStub.shop.findUnique.mockResolvedValue({
        id: 'shop-1',
        name: 'Khalid Mobile Center',
        users: [{ name: 'Khalid', phone: '923001234567', passwordHash: null }],
      });

      const res = await service.getShopOwner('shop-1');

      expect(res).toEqual({
        shopId: 'shop-1',
        hasOwner: true,
        ownerName: 'Khalid',
        ownerPhone: '923001234567',
        hasPassword: false,
      });
    });

    it('surfaces a shop with no owner instead of guessing', async () => {
      prismaStub.shop.findUnique.mockResolvedValue({
        id: 'shop-1',
        name: 'Khalid Mobile Center',
        users: [],
      });

      const res = await service.getShopOwner('shop-1');

      expect(res.hasOwner).toBe(false);
      expect(res.ownerName).toBeNull();
    });
  });

  describe('changeStoreSlug (WF19)', () => {
    it('delegates to StoreService so validation can never drift', async () => {
      const res = await service.changeStoreSlug('shop-1', {
        slug: 'new-address',
      });

      expect(storeStub.changeStoreSlug).toHaveBeenCalledWith(
        'shop-1',
        'new-address',
      );
      expect(res.status).toBe(true);
    });
  });
});

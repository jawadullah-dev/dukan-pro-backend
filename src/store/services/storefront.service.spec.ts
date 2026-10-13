import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorefrontService } from './storefront.service.js';
import { StoreCacheService } from './store-cache.service.js';
import { StoreProductsQueryDto } from '../dto/store-products-query.dto.js';

const settingsRow = {
  shopId: 'shop-1',
  slug: 'khalid-mobile',
  isEnabled: true,
  displayName: 'Khalid Mobile',
  about: 'Genuine phones since 2015.',
  logoUrl: null,
  bannerUrl: null,
  whatsappNumber: null,
  phoneNumber: '0300-1234567',
  address: 'Shop 12, Shahra-e-Faisal',
  city: 'Karachi',
  googleMapsUrl: null,
  openingHours: null,
  facebookUrl: null,
  instagramUrl: null,
  showExactStock: false,
};

function productRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'prod-1',
    name: 'iPhone 14',
    brand: { id: 'br-1', name: 'Apple' },
    category: { id: 'cat-1', name: 'Mobile Phones' },
    trackingType: 'SERIALIZED',
    publicDescription: 'Genuine.',
    contactForPrice: false,
    defaultSellingPrice: 699900n,
    lowStockThreshold: 2,
    ptaStatus: 'PTA_APPROVED',
    isActive: true,
    isPublished: true,
    publishedAt: new Date('2026-10-08T10:00:00.000Z'),
    model: 'A2881',
    color: 'Blue',
    ram: null,
    storage: '128GB',
    stockLevel: null,
    _count: { inventoryUnits: 3 },
    images: [
      { url: 'https://cdn.example.com/b.jpg', sortOrder: 1 },
      { url: 'https://cdn.example.com/a.jpg', sortOrder: 0 },
    ],
    ...overrides,
  };
}

const query: StoreProductsQueryDto = { page: 1, limit: 20 };

describe('StorefrontService (public catalog)', () => {
  let service: StorefrontService;
  let prisma: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorefrontService,
        StoreCacheService,
        {
          provide: PrismaService,
          useValue: {
            shopStoreSettings: { findUnique: jest.fn() },
            shop: { findUnique: jest.fn() },
            product: {
              findMany: jest.fn(),
              count: jest.fn(),
              findFirst: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<StorefrontService>(StorefrontService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uniform 404 (WF22 step 3)', () => {
    const bodyOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        throw new Error('expected a 404');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        return (error as NotFoundException).getResponse();
      }
    };

    it('missing slug, OFF store and SUSPENDED shop answer the SAME body', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValueOnce(null);
      const missing = await bodyOf(service.getStore('nobody'));

      prisma.shopStoreSettings.findUnique.mockResolvedValueOnce({
        ...settingsRow,
        isEnabled: false,
      });
      const off = await bodyOf(service.getStore('khalid-mobile'));

      // A different slug so the OFF row cached above cannot answer this one.
      prisma.shopStoreSettings.findUnique.mockResolvedValueOnce(settingsRow);
      prisma.shop.findUnique.mockResolvedValueOnce({ status: 'SUSPENDED' });
      const suspended = await bodyOf(service.getStore('suspended-store'));

      expect(off).toEqual(missing);
      expect(suspended).toEqual(missing);
      expect(missing).toEqual({
        error: 'Store not available',
        message: ['This store is not available right now.'],
        statusCode: 404,
      });
    });
  });

  describe('GET /public/stores/:slug', () => {
    it('returns the allowlisted profile — no shopId, no toggles', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const profile = await service.getStore('khalid-mobile');

      expect(profile.slug).toBe('khalid-mobile');
      expect(profile.displayName).toBe('Khalid Mobile');
      for (const forbidden of ['shopId', 'isEnabled', 'showExactStock']) {
        expect(forbidden in profile).toBe(false);
      }
    });

    it('reads shops.status fresh even when the slug row is cached', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      await service.getStore('khalid-mobile'); // warms the cache

      prisma.shop.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
      await expect(service.getStore('khalid-mobile')).rejects.toThrow(
        NotFoundException,
      );
      // The settings row came from the cache, not from Prisma.
      expect(prisma.shopStoreSettings.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /public/stores/:slug/products', () => {
    it('filters to active + published products, newest-first, paged', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.product.findMany.mockResolvedValue([
        productRow({
          id: 'p2',
          publishedAt: new Date('2026-10-09T10:00:00.000Z'),
        }),
        productRow({
          id: 'p1',
          publishedAt: new Date('2026-10-08T10:00:00.000Z'),
        }),
      ]);
      prisma.product.count.mockResolvedValue(2);

      const res = await service.getProducts('khalid-mobile', query);

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: 'shop-1',
            isActive: true,
            isPublished: true,
            publishedAt: { not: null },
          },
          orderBy: { publishedAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(res.total).toBe(2);
      expect(res.items).toHaveLength(2);
      expect(res.items[0].id).toBe('p2');
    });

    it('narrows by category id, brand name and search text', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      await service.getProducts('khalid-mobile', {
        ...query,
        category: '01924f0a-0000-7000-8000-000000000010',
        brand: 'Samsung',
        q: 'a15',
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            category: {
              id: '01924f0a-0000-7000-8000-000000000010',
            },
            brand: {
              name: { equals: 'Samsung', mode: 'insensitive' },
            },
            name: { contains: 'a15', mode: 'insensitive' },
          }),
        }),
      );
    });

    it('never lets a page exceed 50 rows (WF22 limit)', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      const res = await service.getProducts('khalid-mobile', {
        page: 3,
        limit: 50,
      });

      expect(res.pageSize).toBe(50);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 50 }),
      );
    });
  });

  describe('product shape (WF22)', () => {
    // A fresh slug per call: StoreCacheService is real, and a warm cache
    // would silently answer the next assertion with the previous settings.
    let slugSeq = 0;
    const firstItem = async (
      overrides: Record<string, unknown> = {},
      settings: Record<string, unknown> = {},
    ) => {
      slugSeq += 1;
      const slug = `store-${slugSeq}`;
      prisma.shopStoreSettings.findUnique.mockResolvedValue({
        ...settingsRow,
        slug,
        ...settings,
      });
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.product.findMany.mockResolvedValue([productRow(overrides)]);
      prisma.product.count.mockResolvedValue(1);
      const res = await service.getProducts(slug, query);
      return res.items[0];
    };

    it('hides the price when contactForPrice is on', async () => {
      const item = await firstItem({ contactForPrice: true });
      expect(item.price).toBeNull();
      expect(item.contactForPrice).toBe(true);
    });

    it('shows the price in paisa when contactForPrice is off', async () => {
      const item = await firstItem();
      expect(item.price).toBe(699900);
    });

    it('keeps stockCount null unless showExactStock is on', async () => {
      const item = await firstItem();
      expect(item.stockCount).toBeNull();
      expect(item.availability).toBe('IN_STOCK');

      const exact = await firstItem({}, { showExactStock: true });
      expect(exact.stockCount).toBe(3);
    });

    it('tags the stock bucket from the threshold', async () => {
      const out = await firstItem({ _count: { inventoryUnits: 0 } });
      const low = await firstItem({ _count: { inventoryUnits: 2 } });
      const inStock = await firstItem({ _count: { inventoryUnits: 5 } });

      expect(out.availability).toBe('OUT_OF_STOCK');
      expect(low.availability).toBe('LOW_STOCK');
      expect(inStock.availability).toBe('IN_STOCK');
    });

    it('counts QUANTITY stock from the stock level row', async () => {
      const item = await firstItem(
        { trackingType: 'QUANTITY', stockLevel: { quantityOnHand: 9 } },
        { showExactStock: true },
      );
      expect(item.stockCount).toBe(9);
      expect(item.availability).toBe('IN_STOCK');
    });

    it('orders image urls by sortOrder (first = cover)', async () => {
      const item = await firstItem();
      expect(item.images).toEqual([
        'https://cdn.example.com/a.jpg',
        'https://cdn.example.com/b.jpg',
      ]);
    });

    it('never leaks private fields (allowlist assertion)', async () => {
      const item = await firstItem();
      for (const forbidden of [
        'shopId',
        'sku',
        'barcode',
        'unitCost',
        'costPrice',
        'trackingType',
        'condition',
        'imei',
        'isActive',
        'isPublished',
        'publishedAt',
        'categoryId',
        'brandId',
        'lowStockThreshold',
        'publicDescription',
      ]) {
        expect(forbidden in item).toBe(false);
      }
      // `description` is the PUBLIC text (publicDescription), never the
      // owner's private notes — the value proves which one it is.
      expect(item.description).toBe('Genuine.');
    });
  });

  describe('GET /public/stores/:slug/products/:productId', () => {
    it('404s a product from another shop, unpublished or inactive — same shape', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.getProduct('khalid-mobile', 'foreign-prod'),
      ).rejects.toThrow(NotFoundException);
      // Cross-shop 404: the WHERE clause scopes by shopId (asserted on the call).
      expect(prisma.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shopId: 'shop-1',
            isActive: true,
            isPublished: true,
          }),
        }),
      );
    });

    it('returns one product with its cover first', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.product.findFirst.mockResolvedValue(productRow());

      const item = await service.getProduct('khalid-mobile', 'prod-1');
      expect(item.id).toBe('prod-1');
      expect(item.images[0]).toBe('https://cdn.example.com/a.jpg');
    });
  });

  describe('owner preview (store still OFF)', () => {
    it('serves the profile even when the store is disabled', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue({
        ...settingsRow,
        isEnabled: false,
      });

      const profile = await service.getPreviewStore('shop-1');
      expect(profile.slug).toBe('khalid-mobile');
    });

    it('404s preview for a shop that never configured a store', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(null);

      await expect(service.getPreviewStore('shop-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('preview product list uses the same catalog filter', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue({
        ...settingsRow,
        isEnabled: false,
      });
      prisma.product.findMany.mockResolvedValue([productRow()]);
      prisma.product.count.mockResolvedValue(1);

      const res = await service.getPreviewProducts('shop-1', query);
      expect(res.items).toHaveLength(1);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isPublished: true }),
        }),
      );
    });
  });

  describe('GET /public/stores/:slug/categories', () => {
    it('lists distinct categories and brands that have a published product', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shop.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      prisma.product.findMany
        .mockResolvedValueOnce([
          { category: { id: 'cat-1', name: 'Mobile Phones' } },
        ])
        .mockResolvedValueOnce([{ brand: { id: 'br-1', name: 'Samsung' } }]);

      const res = await service.getCategories('khalid-mobile');

      expect(res.categories).toEqual([{ id: 'cat-1', name: 'Mobile Phones' }]);
      expect(res.brands).toEqual([{ id: 'br-1', name: 'Samsung' }]);
      expect(prisma.product.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ distinct: ['categoryId'] }),
      );
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ distinct: ['brandId'] }),
      );
    });
  });
});

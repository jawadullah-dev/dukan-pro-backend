import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

const CATEGORY_ID = '01924f0a-0000-7000-8000-0000000000c1';
const BRAND_ID = '01924f0a-0000-7000-8000-0000000000b1';
const SHOP_ID = 'shop-1';

const prismaStub = {
  product: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  category: { findFirst: jest.fn() },
  brand: { findFirst: jest.fn() },
  stockLevel: {
    create: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  },
  purchaseItem: { count: jest.fn() },
  saleItem: { count: jest.fn() },
  $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) =>
    fn(prismaStub),
  ),
};

function uniqueViolation(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: { target },
  });
}

/**
 * The shape Prisma 7 + @prisma/adapter-pg actually produces: there is NO
 * meta.target, only the nested Postgres constraint index name. This is the
 * path every live request takes, so it must be covered.
 */
function adapterUniqueViolation(indexName: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: {
      modelName: 'Product',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { index: indexName },
          table: 'products',
        },
      },
    },
  });
}

function baseProductRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    shopId: SHOP_ID,
    categoryId: CATEGORY_ID,
    brandId: BRAND_ID,
    name: 'Galaxy A15',
    trackingType: 'QUANTITY',
    model: 'SM-A155F',
    color: null,
    ram: null,
    storage: null,
    sku: null,
    barcode: null,
    description: null,
    imageUrl: null,
    defaultPurchasePrice: 4500000n,
    defaultSellingPrice: 699900n,
    lowStockThreshold: 3,
    isActive: true,
    createdAt: new Date('2026-10-05T09:20:00.000Z'),
    updatedAt: new Date('2026-10-05T09:20:00.000Z'),
    category: { name: 'Accessories' },
    brand: { name: 'Samsung' },
    stockLevel: { quantityOnHand: 7 },
    _count: { inventoryUnits: 0 },
    ...overrides,
  };
}

const validCreate = {
  name: 'Galaxy A15',
  categoryId: CATEGORY_ID,
  brandId: BRAND_ID,
  trackingType: 'QUANTITY' as const,
};

describe('ProductsService', () => {
  let service: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaStub.category.findFirst.mockResolvedValue({ id: CATEGORY_ID });
    prismaStub.brand.findFirst.mockResolvedValue({ id: BRAND_ID });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createProduct', () => {
    it('creates a stock_levels row for a QUANTITY product', async () => {
      prismaStub.product.create.mockResolvedValue({ id: 'prod-1' });

      await service.createProduct(validCreate, SHOP_ID, 'user-1');

      expect(prismaStub.product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopId: SHOP_ID,
            name: 'Galaxy A15',
            trackingType: 'QUANTITY',
          }),
        }),
      );
      expect(prismaStub.stockLevel.create).toHaveBeenCalledWith({
        data: {
          productId: 'prod-1',
          shopId: SHOP_ID,
          quantityOnHand: 0,
          avgUnitCost: 0,
        },
      });
    });

    it('creates no stock_levels row for a SERIALIZED product', async () => {
      prismaStub.product.create.mockResolvedValue({ id: 'prod-2' });

      await service.createProduct(
        { ...validCreate, trackingType: 'SERIALIZED' },
        SHOP_ID,
        'user-1',
      );

      expect(prismaStub.stockLevel.create).not.toHaveBeenCalled();
    });

    it('rejects a category owned by another shop', async () => {
      prismaStub.category.findFirst.mockResolvedValue(null);

      await expect(
        service.createProduct(validCreate, SHOP_ID, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaStub.product.create).not.toHaveBeenCalled();
    });

    it('rejects a brand owned by another shop', async () => {
      prismaStub.brand.findFirst.mockResolvedValue(null);

      await expect(
        service.createProduct(validCreate, SHOP_ID, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaStub.product.create).not.toHaveBeenCalled();
    });

    it('scopes the ownership lookup to the shop in the JWT', async () => {
      prismaStub.product.create.mockResolvedValue({ id: 'prod-1' });

      await service.createProduct(validCreate, 'shop-2', 'user-1');

      expect(prismaStub.category.findFirst).toHaveBeenCalledWith({
        where: { id: CATEGORY_ID, shopId: 'shop-2' },
        select: { id: true },
      });
      expect(prismaStub.brand.findFirst).toHaveBeenCalledWith({
        where: { id: BRAND_ID, shopId: 'shop-2' },
        select: { id: true },
      });
    });

    it('maps a duplicate product name to a friendly 400', async () => {
      prismaStub.product.create.mockRejectedValue(
        uniqueViolation(['shop_id', 'name']),
      );

      await expect(
        service.createProduct(validCreate, SHOP_ID, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a duplicate SKU to a SKU-specific 400', async () => {
      prismaStub.product.create.mockRejectedValue(
        uniqueViolation(['shop_id', 'sku']),
      );

      const err = await service
        .createProduct({ ...validCreate, sku: 'A15-BLU' }, SHOP_ID, 'user-1')
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).toContain('SKU');
    });

    it('maps a duplicate barcode to a barcode-specific 400', async () => {
      prismaStub.product.create.mockRejectedValue(
        uniqueViolation(['shop_id', 'barcode']),
      );

      const err = await service
        .createProduct(
          { ...validCreate, barcode: '356938035643809' },
          SHOP_ID,
          'user-1',
        )
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).toContain('barcode');
    });

    it('rethrows errors that are not unique violations', async () => {
      prismaStub.product.create.mockRejectedValue(new Error('boom'));

      await expect(
        service.createProduct(validCreate, SHOP_ID, 'user-1'),
      ).rejects.toThrow('boom');
    });

    describe('with the Prisma 7 driver-adapter error shape (meta.target absent)', () => {
      it('reports a duplicate NAME', async () => {
        prismaStub.product.create.mockRejectedValue(
          adapterUniqueViolation('products_shop_id_name_key'),
        );

        const err = await service
          .createProduct(validCreate, SHOP_ID, 'user-1')
          .catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(JSON.stringify(err.getResponse())).toContain('already exists');
        expect(JSON.stringify(err.getResponse())).not.toContain('SKU');
      });

      it('reports a duplicate SKU, not the name', async () => {
        prismaStub.product.create.mockRejectedValue(
          adapterUniqueViolation('products_shop_id_sku_key'),
        );

        const err = await service
          .createProduct({ ...validCreate, sku: 'A15-BLU' }, SHOP_ID, 'user-1')
          .catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(JSON.stringify(err.getResponse())).toContain('SKU');
      });

      it('reports a duplicate barcode, not the name', async () => {
        prismaStub.product.create.mockRejectedValue(
          adapterUniqueViolation('products_shop_id_barcode_key'),
        );

        const err = await service
          .createProduct(
            { ...validCreate, barcode: '356938035643809' },
            SHOP_ID,
            'user-1',
          )
          .catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(JSON.stringify(err.getResponse())).toContain('barcode');
      });

      it('reports a duplicate name when the SKU was not sent', async () => {
        prismaStub.product.create.mockRejectedValue(
          adapterUniqueViolation('products_shop_id_name_key'),
        );

        const err = await service
          .createProduct(validCreate, SHOP_ID, 'user-1')
          .catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(JSON.stringify(err.getResponse())).toContain('Product');
      });
    });
  });

  describe('getProducts', () => {
    it('scopes every list query to the shop in the JWT', async () => {
      prismaStub.product.findMany.mockResolvedValue([]);
      prismaStub.product.count.mockResolvedValue(0);

      await service.getProducts({ page: 1, pageSize: 10 }, SHOP_ID);

      expect(prismaStub.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shopId: SHOP_ID } }),
      );
      expect(prismaStub.product.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID },
      });
    });

    it('ANDs the search across name, model, sku and barcode without widening shop scope', async () => {
      prismaStub.product.findMany.mockResolvedValue([]);
      prismaStub.product.count.mockResolvedValue(0);

      await service.getProducts(
        { page: 1, pageSize: 10, search: '  a15 ' },
        SHOP_ID,
      );

      const { where } = prismaStub.product.findMany.mock.calls[0][0];
      expect(where.shopId).toBe(SHOP_ID);
      expect(where.OR).toEqual([
        { name: { contains: 'a15', mode: 'insensitive' } },
        { model: { contains: 'a15', mode: 'insensitive' } },
        { sku: { contains: 'a15', mode: 'insensitive' } },
        { barcode: { contains: 'a15', mode: 'insensitive' } },
      ]);
    });

    it('passes category, brand, trackingType and isActive filters through', async () => {
      prismaStub.product.findMany.mockResolvedValue([]);
      prismaStub.product.count.mockResolvedValue(0);

      await service.getProducts(
        {
          page: 1,
          pageSize: 10,
          categoryId: CATEGORY_ID,
          brandId: BRAND_ID,
          trackingType: 'SERIALIZED',
          isActive: false,
        },
        SHOP_ID,
      );

      expect(prismaStub.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            categoryId: CATEGORY_ID,
            brandId: BRAND_ID,
            trackingType: 'SERIALIZED',
            isActive: false,
          },
        }),
      );
    });

    it('returns stock_levels quantity for a QUANTITY product', async () => {
      prismaStub.product.findMany.mockResolvedValue([
        baseProductRow({
          trackingType: 'QUANTITY',
          stockLevel: { quantityOnHand: 7 },
        }),
      ]);
      prismaStub.product.count.mockResolvedValue(1);

      const res = await service.getProducts({ page: 1, pageSize: 10 }, SHOP_ID);

      expect(res.items[0].quantityOnHand).toBe(7);
      expect(res.items[0].categoryName).toBe('Accessories');
      expect(res.items[0].brandName).toBe('Samsung');
      expect(res.items[0].defaultPurchasePrice).toBe(4500000);
    });

    it('returns the IN_STOCK unit count for a SERIALIZED product', async () => {
      prismaStub.product.findMany.mockResolvedValue([
        baseProductRow({
          trackingType: 'SERIALIZED',
          stockLevel: null,
          _count: { inventoryUnits: 4 },
        }),
      ]);
      prismaStub.product.count.mockResolvedValue(1);

      const res = await service.getProducts({ page: 1, pageSize: 10 }, SHOP_ID);

      expect(res.items[0].quantityOnHand).toBe(4);
    });
  });

  describe('getProductById', () => {
    it('finds the product scoped to the shop', async () => {
      prismaStub.product.findFirst.mockResolvedValue(baseProductRow());

      await service.getProductById('prod-1', SHOP_ID);

      expect(prismaStub.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'prod-1', shopId: SHOP_ID } }),
      );
    });

    it('returns 404 when the product belongs to another shop', async () => {
      prismaStub.product.findFirst.mockResolvedValue(null);

      await expect(service.getProductById('prod-1', SHOP_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateProduct', () => {
    it('returns 404 when no row matches the shop', async () => {
      prismaStub.product.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProduct('prod-1', { name: 'New' }, SHOP_ID, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a category owned by another shop', async () => {
      prismaStub.product.findFirst.mockResolvedValue(baseProductRow());
      prismaStub.category.findFirst.mockResolvedValue(null);

      await expect(
        service.updateProduct(
          'prod-1',
          { categoryId: CATEGORY_ID },
          SHOP_ID,
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prismaStub.product.update).not.toHaveBeenCalled();
    });

    it('blocks a trackingType change once purchase history exists', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ trackingType: 'QUANTITY' }),
      );
      prismaStub.purchaseItem.count.mockResolvedValue(2);
      prismaStub.saleItem.count.mockResolvedValue(0);

      await expect(
        service.updateProduct(
          'prod-1',
          { trackingType: 'SERIALIZED' },
          SHOP_ID,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaStub.product.update).not.toHaveBeenCalled();
    });

    it('blocks a trackingType change once sale history exists', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ trackingType: 'SERIALIZED' }),
      );
      prismaStub.purchaseItem.count.mockResolvedValue(0);
      prismaStub.saleItem.count.mockResolvedValue(1);

      await expect(
        service.updateProduct(
          'prod-1',
          { trackingType: 'QUANTITY' },
          SHOP_ID,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('blocks QUANTITY -> SERIALIZED while stock is still on hand', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ trackingType: 'QUANTITY' }),
      );
      prismaStub.purchaseItem.count.mockResolvedValue(0);
      prismaStub.saleItem.count.mockResolvedValue(0);
      prismaStub.stockLevel.findUnique.mockResolvedValue({ quantityOnHand: 5 });

      await expect(
        service.updateProduct(
          'prod-1',
          { trackingType: 'SERIALIZED' },
          SHOP_ID,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaStub.product.update).not.toHaveBeenCalled();
    });

    it('drops the stock counter when switching QUANTITY -> SERIALIZED with no history and no stock', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ trackingType: 'QUANTITY' }),
      );
      prismaStub.purchaseItem.count.mockResolvedValue(0);
      prismaStub.saleItem.count.mockResolvedValue(0);
      prismaStub.stockLevel.findUnique.mockResolvedValue({ quantityOnHand: 0 });
      prismaStub.product.update.mockResolvedValue({});

      await service.updateProduct(
        'prod-1',
        { trackingType: 'SERIALIZED' },
        SHOP_ID,
        'user-1',
      );

      expect(prismaStub.stockLevel.deleteMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1' },
      });
    });

    it('creates a stock counter when switching SERIALIZED -> QUANTITY with no history', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ trackingType: 'SERIALIZED' }),
      );
      prismaStub.purchaseItem.count.mockResolvedValue(0);
      prismaStub.saleItem.count.mockResolvedValue(0);
      prismaStub.stockLevel.findUnique.mockResolvedValue(null);
      prismaStub.product.update.mockResolvedValue({});

      await service.updateProduct(
        'prod-1',
        { trackingType: 'QUANTITY' },
        SHOP_ID,
        'user-1',
      );

      expect(prismaStub.stockLevel.create).toHaveBeenCalledWith({
        data: {
          productId: 'prod-1',
          shopId: SHOP_ID,
          quantityOnHand: 0,
          avgUnitCost: 0,
        },
      });
    });

    it('does not touch stock levels when trackingType is unchanged', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ trackingType: 'QUANTITY' }),
      );
      prismaStub.product.update.mockResolvedValue({});

      await service.updateProduct(
        'prod-1',
        { name: 'Galaxy A15 v2', lowStockThreshold: 5 },
        SHOP_ID,
        'user-1',
      );

      expect(prismaStub.stockLevel.create).not.toHaveBeenCalled();
      expect(prismaStub.stockLevel.deleteMany).not.toHaveBeenCalled();
      expect(prismaStub.purchaseItem.count).not.toHaveBeenCalled();
      expect(prismaStub.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { name: 'Galaxy A15 v2', lowStockThreshold: 5 },
      });
    });

    it('maps a duplicate name on update to a friendly 400', async () => {
      prismaStub.product.findFirst.mockResolvedValue(baseProductRow());
      prismaStub.product.update.mockRejectedValue(
        uniqueViolation(['shop_id', 'name']),
      );

      await expect(
        service.updateProduct('prod-1', { name: 'Dup' }, SHOP_ID, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('writes the R1.2 publish fields and never touches publishedAt', async () => {
      prismaStub.product.findFirst.mockResolvedValue(baseProductRow());
      prismaStub.product.update.mockResolvedValue({});

      await service.updateProduct(
        'prod-1',
        {
          isPublished: true,
          publicDescription: '  Box pack.  ',
          contactForPrice: true,
          ptaStatus: 'NON_PTA',
        },
        SHOP_ID,
        'user-1',
      );

      expect(prismaStub.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isPublished: true,
            publicDescription: 'Box pack.',
            contactForPrice: true,
            ptaStatus: 'NON_PTA',
          }),
        }),
      );
      const data = prismaStub.product.update.mock.calls[0][0].data as object;
      expect('publishedAt' in data).toBe(false);
    });

    it('refuses to publish a product that is inactive (WF20)', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ isActive: false }),
      );

      await expect(
        service.updateProduct(
          'prod-1',
          { isPublished: true },
          SHOP_ID,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaStub.product.update).not.toHaveBeenCalled();
    });

    it('refuses publish + deactivate in the same request', async () => {
      prismaStub.product.findFirst.mockResolvedValue(
        baseProductRow({ isActive: true }),
      );

      await expect(
        service.updateProduct(
          'prod-1',
          { isActive: false, isPublished: true },
          SHOP_ID,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prismaStub.product.update).not.toHaveBeenCalled();
    });
  });

  describe('publishProducts (bulk, WF20)', () => {
    it('flips the whole selection in one transaction', async () => {
      prismaStub.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Galaxy A15', isActive: true },
        { id: 'p2', name: 'iPhone 14', isActive: true },
      ]);

      const res = await service.publishProducts(
        { ids: ['p1', 'p2'], isPublished: true },
        SHOP_ID,
      );

      expect(prismaStub.product.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['p1', 'p2'] }, shopId: SHOP_ID },
        data: { isPublished: true },
      });
      expect(res.message).toBe('2 products published successfully');
    });

    it('404s a foreign id instead of silently skipping it', async () => {
      prismaStub.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Galaxy A15', isActive: true },
      ]);

      await expect(
        service.publishProducts(
          { ids: ['p1', 'foreign-id'], isPublished: true },
          SHOP_ID,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prismaStub.product.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to bulk-publish an inactive product', async () => {
      prismaStub.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Galaxy A15', isActive: false },
      ]);

      await expect(
        service.publishProducts({ ids: ['p1'], isPublished: true }, SHOP_ID),
      ).rejects.toThrow(BadRequestException);
      expect(prismaStub.product.updateMany).not.toHaveBeenCalled();
    });

    it('bulk-unpublish does not care about isActive', async () => {
      prismaStub.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Galaxy A15', isActive: false },
      ]);

      const res = await service.publishProducts(
        { ids: ['p1'], isPublished: false },
        SHOP_ID,
      );

      expect(prismaStub.product.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['p1'] }, shopId: SHOP_ID },
        data: { isPublished: false },
      });
      expect(res.message).toBe('1 product unpublished successfully');
    });
  });

  describe('deleteProduct', () => {
    it('soft-deactivates only a product owned by the shop', async () => {
      prismaStub.product.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteProduct('prod-1', SHOP_ID, 'user-1');

      expect(prismaStub.product.updateMany).toHaveBeenCalledWith({
        where: { id: 'prod-1', shopId: SHOP_ID },
        data: { isActive: false },
      });
    });

    it('returns 404 when no row matches the shop', async () => {
      prismaStub.product.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteProduct('prod-1', SHOP_ID, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const SHOP_ID = 'shop-1';
const PRODUCT_ID = 'prod-1';
const UNIT_ID = 'unit-1';

const prismaStub = {
  product: { findFirst: jest.fn() },
  stockLevel: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  inventoryUnit: { update: jest.fn() },
  inventoryMovement: {
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  stockLevel: {
    findUnique: jest.Mock;
    update: jest.Mock;
    create: jest.Mock;
  };
  inventoryUnit: { update: jest.Mock };
  inventoryMovement: { create: jest.Mock };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  const tx: TxStub = {
    $queryRaw: jest.fn().mockResolvedValue([{ quantity_on_hand: 10 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    stockLevel: {
      findUnique: jest.fn().mockResolvedValue({ quantityOnHand: 6 }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    inventoryUnit: {
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryMovement: {
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  return tx;
}

function quantityProduct() {
  return { id: PRODUCT_ID, name: 'USB Cable', trackingType: 'QUANTITY' };
}

function phoneProduct() {
  return { id: PRODUCT_ID, name: 'Samsung Galaxy', trackingType: 'SERIALIZED' };
}

function adjustmentRequest(overrides: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT_ID,
    type: 'ADJUSTMENT',
    reason: 'Counting difference',
    countedQuantity: 13,
    ...overrides,
  } as any;
}

function writeOffRequest(overrides: Record<string, unknown> = {}) {
  return {
    productId: PRODUCT_ID,
    type: 'DAMAGED',
    reason: 'Broken in the box',
    quantity: 2,
    ...overrides,
  } as any;
}

describe('InventoryService', () => {
  let service: InventoryService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.product.findFirst.mockResolvedValue(quantityProduct());
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAdjustment — product gate', () => {
    it('404s when the product does not belong to this shop or is inactive', async () => {
      prismaStub.product.findFirst.mockResolvedValue(null);

      await expect(
        service.createAdjustment(adjustmentRequest(), SHOP_ID),
      ).rejects.toThrow(NotFoundException);
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('filters the product read by shopId from the JWT, never a body field', async () => {
      await service.createAdjustment(adjustmentRequest(), SHOP_ID);

      expect(prismaStub.product.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: PRODUCT_ID, shopId: SHOP_ID, isActive: true },
        }),
      );
    });
  });

  describe('createAdjustment — shape rules (400 before any write)', () => {
    it('refuses ADJUSTMENT on a SERIALIZED product', async () => {
      prismaStub.product.findFirst.mockResolvedValue(phoneProduct());

      await expect(
        service.createAdjustment(adjustmentRequest(), SHOP_ID),
      ).rejects.toThrow(BadRequestException);
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('demands countedQuantity for ADJUSTMENT', async () => {
      await expect(
        service.createAdjustment(
          adjustmentRequest({ countedQuantity: undefined }),
          SHOP_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects the accessory write-off fields on an ADJUSTMENT', async () => {
      await expect(
        service.createAdjustment(adjustmentRequest({ quantity: 2 }), SHOP_ID),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.createAdjustment(
          adjustmentRequest({ inventoryUnitId: UNIT_ID }),
          SHOP_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('demands quantity for an accessory DAMAGED/LOST', async () => {
      await expect(
        service.createAdjustment(
          writeOffRequest({ quantity: undefined }),
          SHOP_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects countedQuantity on an accessory DAMAGED/LOST', async () => {
      await expect(
        service.createAdjustment(
          writeOffRequest({ countedQuantity: 9 }),
          SHOP_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('demands inventoryUnitId for a phone DAMAGED/LOST and rejects accessory fields', async () => {
      prismaStub.product.findFirst.mockResolvedValue(phoneProduct());

      await expect(
        service.createAdjustment(
          writeOffRequest({ inventoryUnitId: undefined, quantity: undefined }),
          SHOP_ID,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createAdjustment(
          writeOffRequest({ inventoryUnitId: UNIT_ID, quantity: 2 }),
          SHOP_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createAdjustment — accessory ADJUSTMENT', () => {
    it('locks the stock row FOR UPDATE, writes the delta as a movement', async () => {
      const res = await service.createAdjustment(
        adjustmentRequest({ countedQuantity: 13 }), // current 10 → +3
        SHOP_ID,
      );

      expect(res).toEqual({
        kind: 'created',
        message: 'Stock change recorded successfully',
      });
      expect(
        String((tx.$queryRaw.mock.calls[0][0] as string[]).join('')).replace(
          /\s+/g,
          ' ',
        ),
      ).toContain('SELECT quantity_on_hand FROM stock_levels');
      expect(
        String((tx.$queryRaw.mock.calls[0][0] as string[]).join('')),
      ).toContain('FOR UPDATE');
      expect(tx.stockLevel.update).toHaveBeenCalledWith({
        where: { productId: PRODUCT_ID },
        data: { quantityOnHand: 13 },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          productId: PRODUCT_ID,
          type: 'ADJUSTMENT',
          quantityChange: 3,
          reason: 'Counting difference',
        }),
      });
    });

    it('returns nochange (200, writes nothing) when the count already matches', async () => {
      const res = await service.createAdjustment(
        adjustmentRequest({ countedQuantity: 10 }), // current 10 → delta 0
        SHOP_ID,
      );

      expect(res).toEqual({
        kind: 'nochange',
        message: 'Counted matches the system — no change recorded',
      });
      expect(tx.stockLevel.update).not.toHaveBeenCalled();
      expect(tx.stockLevel.create).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('creates the stock level row when one does not exist yet', async () => {
      tx.$queryRaw.mockResolvedValue([]); // no stock_levels row yet

      const res = await service.createAdjustment(
        adjustmentRequest({ countedQuantity: 5 }),
        SHOP_ID,
      );

      expect(res.kind).toBe('created');
      expect(tx.stockLevel.create).toHaveBeenCalledWith({
        data: {
          productId: PRODUCT_ID,
          shopId: SHOP_ID,
          quantityOnHand: 5,
          avgUnitCost: 0n,
        },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantityChange: 5 }),
      });
    });

    it('supports counting down to an empty shelf (countedQuantity = 0)', async () => {
      const res = await service.createAdjustment(
        adjustmentRequest({ countedQuantity: 0 }), // current 10 → −10
        SHOP_ID,
      );

      expect(res.kind).toBe('created');
      expect(tx.stockLevel.update).toHaveBeenCalledWith({
        where: { productId: PRODUCT_ID },
        data: { quantityOnHand: 0 },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ quantityChange: -10 }),
      });
    });
  });

  describe('createAdjustment — accessory DAMAGED / LOST', () => {
    it('subtracts atomically and appends a movement with the write-off type', async () => {
      const res = await service.createAdjustment(
        writeOffRequest({ type: 'LOST', quantity: 2 }),
        SHOP_ID,
      );

      expect(res).toEqual({
        kind: 'created',
        message: 'Stock change recorded successfully',
      });
      expect(
        String((tx.$executeRaw.mock.calls[0][0] as string[]).join(' ')).replace(
          /\s+/g,
          ' ',
        ),
      ).toContain(
        'UPDATE stock_levels SET quantity_on_hand = quantity_on_hand -',
      );
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'LOST',
          quantityChange: -2,
          reason: 'Broken in the box',
        }),
      });
    });

    it('refuses when the atomic update removes nothing (insufficient stock)', async () => {
      tx.$executeRaw.mockResolvedValue(0); // quantity_on_hand < requested

      await expect(
        service.createAdjustment(writeOffRequest(), SHOP_ID),
      ).rejects.toThrow(BadRequestException);
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('createAdjustment — phone DAMAGED / LOST', () => {
    beforeEach(() => {
      prismaStub.product.findFirst.mockResolvedValue(phoneProduct());
    });

    it("flips the unit's status and writes a −1 movement with the reason", async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: UNIT_ID, status: 'IN_STOCK', imei1: '1112233344455' },
      ]);

      const res = await service.createAdjustment(
        writeOffRequest({ quantity: undefined, inventoryUnitId: UNIT_ID }),
        SHOP_ID,
      );

      expect(res.kind).toBe('created');
      expect(
        String((tx.$queryRaw.mock.calls[0][0] as string[]).join('')).replace(
          /\s+/g,
          ' ',
        ),
      ).toContain('SELECT id, status, imei1 FROM inventory_units');
      expect(
        String((tx.$queryRaw.mock.calls[0][0] as string[]).join('')),
      ).toContain('FOR UPDATE');
      expect(tx.inventoryUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_ID },
        data: { status: 'DAMAGED' },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          inventoryUnitId: UNIT_ID,
          type: 'DAMAGED',
          quantityChange: -1,
          reason: 'Broken in the box',
        }),
      });
    });

    it('404s when the unit is not a phone of this shop and this product', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.createAdjustment(
          writeOffRequest({ quantity: undefined, inventoryUnitId: UNIT_ID }),
          SHOP_ID,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(tx.inventoryUnit.update).not.toHaveBeenCalled();
    });

    it('refuses a unit that is no longer IN_STOCK', async () => {
      tx.$queryRaw.mockResolvedValue([
        { id: UNIT_ID, status: 'SOLD', imei1: '1112233344555' },
      ]);

      await expect(
        service.createAdjustment(
          writeOffRequest({ quantity: undefined, inventoryUnitId: UNIT_ID }),
          SHOP_ID,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(tx.inventoryUnit.update).not.toHaveBeenCalled();
    });
  });

  describe('getInventoryMovements', () => {
    const row = {
      id: 'm-1',
      shopId: SHOP_ID,
      productId: PRODUCT_ID,
      inventoryUnitId: null,
      type: 'ADJUSTMENT',
      quantityChange: 3,
      reason: 'Counting difference',
      referenceType: null,
      referenceId: null,
      createdAt: new Date('2026-10-07T10:00:00Z'),
      product: { name: 'USB Cable' },
      inventoryUnit: null,
    };

    beforeEach(() => {
      prismaStub.inventoryMovement.findMany.mockResolvedValue([row]);
      prismaStub.inventoryMovement.count.mockResolvedValue(1);
    });

    it('defaults to manual movement types only, shop-scoped and paginated', async () => {
      const res = await service.getInventoryMovements({}, SHOP_ID);

      expect(prismaStub.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            type: { in: ['ADJUSTMENT', 'DAMAGED', 'LOST'] },
          },
          skip: 0,
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(res).toEqual({
        items: [
          {
            id: 'm-1',
            shopId: SHOP_ID,
            productId: PRODUCT_ID,
            productName: 'USB Cable',
            inventoryUnitId: null,
            imei: null,
            type: 'ADJUSTMENT',
            quantityChange: 3,
            reason: 'Counting difference',
            referenceType: null,
            referenceId: null,
            createdAt: row.createdAt,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      });
    });

    it('applies type, date range, search and sort filters', async () => {
      await service.getInventoryMovements(
        {
          page: 2,
          pageSize: 25,
          type: 'DAMAGED',
          from: '2026-10-01',
          to: '2026-10-31',
          search: 'cable',
          sortBy: 'quantityChange',
          sortOrder: 'asc',
        } as any,
        SHOP_ID,
      );

      const call = prismaStub.inventoryMovement.findMany.mock.calls[0][0];
      expect(call.where.type).toBe('DAMAGED');
      expect(call.where.AND).toEqual([
        { createdAt: { gte: new Date('2026-10-01') } },
        { createdAt: { lte: new Date('2026-10-31') } },
      ]);
      expect(call.where.OR).toEqual([
        { product: { name: { contains: 'cable', mode: 'insensitive' } } },
        { reason: { contains: 'cable', mode: 'insensitive' } },
      ]);
      expect(call.skip).toBe(25);
      expect(call.take).toBe(25);
      expect(call.orderBy).toEqual({ quantityChange: 'asc' });
    });
  });
});

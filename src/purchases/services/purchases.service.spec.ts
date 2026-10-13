import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PurchasesService } from './purchases.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';
const SUPPLIER_ID = '01924f0a-0000-7000-8000-0000000000a1';
const QUANTITY_PRODUCT_ID = '01924f0a-0000-7000-8000-0000000000b1';
const SERIAL_PRODUCT_ID = '01924f0a-0000-7000-8000-0000000000b2';

const prismaStub = {
  purchase: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  supplier: { findFirst: jest.fn() },
  product: { findMany: jest.fn() },
  inventoryUnit: { findMany: jest.fn(), findFirst: jest.fn() },
  stockLevel: { findFirst: jest.fn() },
  supplierPayment: { findMany: jest.fn(), aggregate: jest.fn() },
  cashMovement: { aggregate: jest.fn() },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  purchase: { create: jest.Mock; update: jest.Mock };
  purchaseItem: { create: jest.Mock; findMany: jest.Mock };
  inventoryUnit: { create: jest.Mock; update: jest.Mock };
  inventoryMovement: { create: jest.Mock };
  stockLevel: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
  supplierPayment: {
    create: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  cashMovement: {
    create: jest.Mock;
    findFirst: jest.Mock;
    aggregate: jest.Mock;
  };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  const tx: TxStub = {
    // First query locks the shop row (cash serialisation), the rest is the
    // next_purchase_no counter.
    $queryRaw: jest
      .fn()
      .mockImplementation((strings: any) =>
        Promise.resolve(
          strings?.[0]?.includes('FOR UPDATE')
            ? [{ id: SHOP_ID }]
            : [{ next: 7 }],
        ),
      ),
    purchase: {
      create: jest.fn().mockResolvedValue({ id: 'purchase-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    purchaseItem: {
      create: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve({ id: `item-${args.data.productId}` }),
        ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    inventoryUnit: {
      create: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve({ id: `unit-${args.data.imei1}` }),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    inventoryMovement: { create: jest.fn().mockResolvedValue({ id: 'm-1' }) },
    stockLevel: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    supplierPayment: {
      create: jest.fn().mockResolvedValue({ id: 'sp-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    cashMovement: {
      create: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'cm-original-1' }),
      // Plenty of opening cash by default so ordinary payments never prompt.
      aggregate: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          _sum: {
            amount: args.where.direction === 'IN' ? 100000000n : 0n,
          },
        }),
      ),
    },
    ...overrides,
  };
  return tx;
}

function serialisePurchaseRequest(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: '01924f0a-0000-7000-8000-00000000beef',
    supplierId: SUPPLIER_ID,
    supplierInvoiceRef: 'AB-771',
    purchaseDate: '2026-10-06',
    paidNow: 0,
    isOpeningStock: false,
    confirmOverdraft: false,
    items: [
      {
        productId: QUANTITY_PRODUCT_ID,
        quantity: 40,
        unitCost: 50000,
      },
    ],
    ...overrides,
  } as any;
}

describe('PurchasesService', () => {
  let service: PurchasesService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<PurchasesService>(PurchasesService);

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.purchase.findFirst.mockResolvedValue(null);
    prismaStub.supplier.findFirst.mockResolvedValue({ id: SUPPLIER_ID });
    prismaStub.product.findMany.mockResolvedValue([
      {
        id: QUANTITY_PRODUCT_ID,
        name: 'Samsung Charger',
        trackingType: 'QUANTITY',
      },
      {
        id: SERIAL_PRODUCT_ID,
        name: 'Samsung A15',
        trackingType: 'SERIALIZED',
      },
    ]);
    prismaStub.inventoryUnit.findMany.mockResolvedValue([]);
    prismaStub.inventoryUnit.findFirst.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPurchase — totals and money', () => {
    it('computes totalAmount from the lines and never reads it from the client', async () => {
      await service.createPurchase(
        serialisePurchaseRequest({ totalAmount: 1 }),
        SHOP_ID,
        USER_ID,
      );

      const purchaseData = tx.purchase.create.mock.calls[0][0].data;
      expect(purchaseData.totalAmount).toBe(2000000n);
    });

    it('writes nothing but stock and stock history when the purchase is fully on Udhar', async () => {
      const res = await service.createPurchase(
        serialisePurchaseRequest({ paidNow: 0 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Purchase created successfully',
      });
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('writes a supplier payment and an OUT cash row for a part payment', async () => {
      await service.createPurchase(
        serialisePurchaseRequest({ paidNow: 500000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.supplierPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          supplierId: SUPPLIER_ID,
          purchaseId: 'purchase-1',
          amount: 500000n,
        }),
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'SUPPLIER_PAYMENT',
          direction: 'OUT',
          amount: 500000n,
          // Ledger follows the bill's business day, not wall-clock now
          // (same convention as WF7's movementDate = paymentDate).
          movementDate: new Date('2026-10-06'),
          referenceType: 'PURCHASE',
          isOverdraft: false,
        }),
      });
    });

    it('rejects a paid amount larger than the purchase total', async () => {
      await expect(
        service.createPurchase(
          serialisePurchaseRequest({ paidNow: 999999999999 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('stores blank notes as null instead of an empty string', async () => {
      await service.createPurchase(
        serialisePurchaseRequest({ notes: '   ' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.purchase.create.mock.calls[0][0].data.notes).toBeNull();

      await service.createPurchase(
        serialisePurchaseRequest({ notes: '' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.purchase.create.mock.calls[1][0].data.notes).toBeNull();

      await service.createPurchase(
        serialisePurchaseRequest({ notes: 'Sunday market' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.purchase.create.mock.calls[2][0].data.notes).toBe(
        'Sunday market',
      );
    });

    it('an opening-stock purchase never touches payable or cash', async () => {
      const res = await service.createPurchase(
        serialisePurchaseRequest({
          isOpeningStock: true,
          paidNow: 0,
          items: [
            { productId: QUANTITY_PRODUCT_ID, quantity: 5, unitCost: 10000 },
          ],
        }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Purchase created successfully',
      });
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
      expect(tx.purchase.create.mock.calls[0][0].data.isOpeningStock).toBe(
        true,
      );
    });

    it('refuses to attach a payment to an opening-stock purchase', async () => {
      await expect(
        service.createPurchase(
          serialisePurchaseRequest({ isOpeningStock: true, paidNow: 500 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createPurchase — the purchase number counter', () => {
    it('locks the shop row before anything else, then reads+increments the counter to P-0007', async () => {
      await service.createPurchase(
        serialisePurchaseRequest(),
        SHOP_ID,
        USER_ID,
      );

      // Call 1 = the shop-row FOR UPDATE that serialises cash reads.
      const lockSql = tx.$queryRaw.mock.calls[0][0] as string[];
      expect(lockSql.join('')).toContain('FOR UPDATE');
      expect(lockSql.join('')).toContain('SELECT id FROM shops');
      expect(tx.$queryRaw.mock.calls[0][1]).toBe(SHOP_ID);
      // Call 2 = the counter UPDATE ... RETURNING.
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(tx.purchase.create.mock.calls[0][0].data.purchaseNo).toBe(
        'P-0007',
      );
    });
  });

  describe('createPurchase — idempotency', () => {
    it('returns "already saved" without opening a transaction when the clientRequestId exists', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue({ id: 'purchase-1' });

      const res = await service.createPurchase(
        serialisePurchaseRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Purchase already saved',
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
      expect(tx.purchase.create).not.toHaveBeenCalled();
    });

    it('scopes the idempotency lookup to the shop', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue({ id: 'purchase-1' });

      await service.createPurchase(
        serialisePurchaseRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(prismaStub.purchase.findFirst).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID, clientRequestId: expect.any(String) },
        select: { id: true },
      });
    });

    it('maps a racing P2002 on the idempotency index to the replay message', async () => {
      prismaStub.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.0.0',
          meta: {
            driverAdapterError: {
              name: 'DriverAdapterError',
              cause: {
                originalCode: '23505',
                kind: 'UniqueConstraintViolation',
                constraint: {
                  index: 'purchases_shop_id_client_request_id_key',
                },
                table: 'purchases',
              },
            },
          },
        }),
      );

      const res = await service.createPurchase(
        serialisePurchaseRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Purchase already saved',
      });
    });

    it('rethrows a P2002 from any other index instead of swallowing it', async () => {
      prismaStub.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.0.0',
          meta: {
            driverAdapterError: {
              name: 'DriverAdapterError',
              cause: {
                originalCode: '23505',
                kind: 'UniqueConstraintViolation',
                constraint: {
                  index: 'purchases_shop_id_purchase_no_key',
                },
                table: 'purchases',
              },
            },
          },
        }),
      );

      await expect(
        service.createPurchase(serialisePurchaseRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('createPurchase — IMEI rules', () => {
    const phoneLine = {
      productId: SERIAL_PRODUCT_ID,
      quantity: 2,
      unitCost: 2000000,
      imeis: ['111223344556677', '111223344556688'],
      condition: 'USED',
    };

    it('creates one inventory unit and one movement per IMEI', async () => {
      await service.createPurchase(
        serialisePurchaseRequest({ items: [phoneLine] }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.inventoryUnit.create).toHaveBeenCalledTimes(2);
      expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(2);
      expect(tx.inventoryUnit.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          imei1: '111223344556677',
          condition: 'USED',
        }),
      );
      expect(tx.stockLevel.update).not.toHaveBeenCalled();
      expect(tx.stockLevel.create).not.toHaveBeenCalled();
    });

    it('rejects a phone line whose IMEI count does not equal the quantity', async () => {
      await expect(
        service.createPurchase(
          serialisePurchaseRequest({
            items: [{ ...phoneLine, imeis: ['111223344556677'] }],
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects the same IMEI listed twice in one request', async () => {
      await expect(
        service.createPurchase(
          serialisePurchaseRequest({
            items: [
              {
                productId: SERIAL_PRODUCT_ID,
                quantity: 2,
                unitCost: 2000000,
                imeis: ['111223344556677', '111223344556677'],
              },
            ],
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an IMEI the shop already owns', async () => {
      prismaStub.inventoryUnit.findMany.mockResolvedValue([
        { imei1: '111223344556677' },
      ]);

      await expect(
        service.createPurchase(
          serialisePurchaseRequest({ items: [phoneLine] }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.inventoryUnit.findMany).toHaveBeenCalledWith({
        where: {
          shopId: SHOP_ID,
          imei1: { in: phoneLine.imeis },
        },
        select: { imei1: true },
      });
    });

    it('rejects IMEIs on a quantity-tracked accessory', async () => {
      await expect(
        service.createPurchase(
          serialisePurchaseRequest({
            items: [
              {
                productId: QUANTITY_PRODUCT_ID,
                quantity: 2,
                unitCost: 50000,
                imeis: ['111223344556677', '111223344556688'],
              },
            ],
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createPurchase — quantity stock and average cost', () => {
    it('adds the line to stock_levels and writes a single PURCHASE movement', async () => {
      tx.stockLevel.findUnique.mockResolvedValue({
        quantityOnHand: 40,
        avgUnitCost: 50000n,
      });

      await service.createPurchase(
        serialisePurchaseRequest({
          items: [
            { productId: QUANTITY_PRODUCT_ID, quantity: 20, unitCost: 60000 },
          ],
        }),
        SHOP_ID,
        USER_ID,
      );

      // (40 × 50000 + 20 × 60000) / 60 = 53333 paisa — the WF6 example.
      expect(tx.stockLevel.update).toHaveBeenCalledWith({
        where: { productId: QUANTITY_PRODUCT_ID },
        data: { quantityOnHand: 60, avgUnitCost: 53333n },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'PURCHASE',
          quantityChange: 20,
          referenceType: 'PURCHASE',
          referenceId: 'purchase-1',
        }),
      });
      expect(tx.inventoryUnit.create).not.toHaveBeenCalled();
    });

    it('creates the stock_levels row when the product has none yet', async () => {
      await service.createPurchase(
        serialisePurchaseRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.stockLevel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productId: QUANTITY_PRODUCT_ID,
          shopId: SHOP_ID,
          quantityOnHand: 40,
        }),
      });
    });
  });

  describe('createPurchase — overdraft prompt', () => {
    it('returns a confirm prompt and writes nothing when cash would go below zero', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 500000n : 0n },
        }),
      );

      const res = await service.createPurchase(
        serialisePurchaseRequest({ paidNow: 1500000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(
        expect.objectContaining({ confirmOverdraft: true, shortfall: 1000000 }),
      );
      expect(prismaStub.purchase.create).not.toHaveBeenCalled();
      expect(tx.purchase.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('saves with isOverdraft true once confirmOverdraft is sent', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 500000n : 0n },
        }),
      );

      const res = await service.createPurchase(
        serialisePurchaseRequest({ paidNow: 1500000, confirmOverdraft: true }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Purchase created successfully',
      });
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        true,
      );
    });

    it('does not prompt when the payment fits in the drawer', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: {
            amount: args.where.direction === 'IN' ? 50000000n : 0n,
          },
        }),
      );

      const res = await service.createPurchase(
        serialisePurchaseRequest({ paidNow: 500000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Purchase created successfully',
      });
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        false,
      );
    });
  });

  describe('createPurchase — tenant isolation', () => {
    it('404s on a supplier that belongs to another shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.createPurchase(serialisePurchaseRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID, shopId: SHOP_ID },
        select: { id: true },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('404s on a product that belongs to another shop', async () => {
      prismaStub.product.findMany.mockResolvedValue([]);

      await expect(
        service.createPurchase(serialisePurchaseRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: [QUANTITY_PRODUCT_ID] }, shopId: SHOP_ID },
        select: { id: true, name: true, trackingType: true },
      });
    });
  });

  describe('getPurchases', () => {
    it('scopes the list to the shop from the JWT', async () => {
      prismaStub.purchase.findMany.mockResolvedValue([]);
      prismaStub.purchase.count.mockResolvedValue(0);

      await service.getPurchases({ page: 1, pageSize: 10 }, SHOP_ID);

      const where = prismaStub.purchase.findMany.mock.calls[0][0].where;
      expect(where.shopId).toBe(SHOP_ID);
      expect(prismaStub.purchase.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID },
      });
    });

    it('filters by supplier, status and opening-stock flag', async () => {
      prismaStub.purchase.findMany.mockResolvedValue([]);
      prismaStub.purchase.count.mockResolvedValue(0);

      await service.getPurchases(
        {
          page: 1,
          pageSize: 10,
          supplierId: SUPPLIER_ID,
          status: 'ACTIVE',
          isOpeningStock: false,
        } as any,
        SHOP_ID,
      );

      expect(prismaStub.purchase.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          shopId: SHOP_ID,
          supplierId: SUPPLIER_ID,
          status: 'ACTIVE',
          isOpeningStock: false,
        }),
      );
    });

    it('ANDs the purchaseDate range instead of overwriting it', async () => {
      prismaStub.purchase.findMany.mockResolvedValue([]);
      prismaStub.purchase.count.mockResolvedValue(0);

      await service.getPurchases(
        {
          page: 1,
          pageSize: 10,
          from: '2026-10-01',
          to: '2026-10-31',
          search: 'AB-771',
        },
        SHOP_ID,
      );

      const where = prismaStub.purchase.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.OR).toHaveLength(3);
      expect(where.shopId).toBe(SHOP_ID);
    });
  });

  describe('getPurchaseById', () => {
    it('404s when the purchase belongs to another shop', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue(null);

      await expect(
        service.getPurchaseById('purchase-1', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.purchase.findFirst).toHaveBeenCalledWith({
        where: { id: 'purchase-1', shopId: SHOP_ID },
        include: expect.anything(),
      });
    });

    it('maps BigInt money to plain numbers and formats the business date', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue({
        id: 'purchase-1',
        shopId: SHOP_ID,
        supplierId: SUPPLIER_ID,
        supplier: { name: 'ABC Mobiles' },
        purchaseNo: 'P-0001',
        supplierInvoiceRef: 'AB-771',
        purchaseDate: new Date('2026-10-06T00:00:00.000Z'),
        totalAmount: 29000000n,
        isOpeningStock: false,
        status: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        cancelledById: null,
        clientRequestId: 'req-1',
        notes: null,
        createdById: USER_ID,
        createdAt: new Date('2026-10-06T09:20:00.000Z'),
        updatedAt: new Date('2026-10-06T09:20:00.000Z'),
        items: [
          {
            id: 'item-1',
            productId: SERIAL_PRODUCT_ID,
            product: { name: 'Samsung A15' },
            quantity: 3,
            unitCost: 9000000n,
            totalCost: 27000000n,
            inventoryUnits: [{ imei1: '111' }, { imei1: '222' }],
          },
        ],
      });

      const res = await service.getPurchaseById('purchase-1', SHOP_ID);

      expect(res.totalAmount).toBe(29000000);
      expect(res.purchaseDate).toBe('2026-10-06');
      expect(res.supplierName).toBe('ABC Mobiles');
      expect(res.items[0].imeis).toEqual(['111', '222']);
      expect(res.items[0].totalCost).toBe(27000000);
    });
  });

  describe('cancelPurchase — WF12', () => {
    const UNIT_ID = '01924f0a-0000-7000-8000-000000000301';
    const activePurchase = {
      id: 'purchase-1',
      status: 'ACTIVE',
      purchaseNo: 'P-0007',
    };
    const cancelDto = { cancelReason: 'Bought from the wrong supplier' };
    const phoneLine = [
      {
        productId: SERIAL_PRODUCT_ID,
        quantity: 1,
        product: { name: 'Samsung A15', trackingType: 'SERIALIZED' },
        inventoryUnits: [{ id: UNIT_ID, imei1: '111223344556677' }],
      },
    ];
    const accessoryLine = [
      {
        productId: QUANTITY_PRODUCT_ID,
        quantity: 5,
        product: { name: 'Samsung Charger', trackingType: 'QUANTITY' },
        inventoryUnits: [],
      },
    ];

    beforeEach(() => {
      prismaStub.purchase.findFirst.mockResolvedValue(activePurchase);
      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM purchases')) return [{ status: 'ACTIVE' }];
        if (sql.includes('FROM inventory_units'))
          return [
            { id: UNIT_ID, status: 'IN_STOCK', imei1: '111223344556677' },
          ];
        if (sql.includes('stock_levels')) return [{ quantity_on_hand: 40 }];
        return [];
      });
    });

    it('marks the purchase CANCELLED with reason, time and user', async () => {
      const res = await service.cancelPurchase(
        'purchase-1',
        cancelDto,
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Purchase cancelled successfully',
      });
      expect(tx.purchase.update).toHaveBeenCalledWith({
        where: { id: 'purchase-1', shopId: SHOP_ID },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Bought from the wrong supplier',
          cancelledById: USER_ID,
          cancelledAt: expect.any(Date),
        }),
      });
    });

    it('voids every phone from the bill with a PURCHASE_CANCEL movement', async () => {
      tx.purchaseItem.findMany.mockResolvedValue(phoneLine);

      await service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID);

      expect(tx.inventoryUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_ID },
        data: { status: 'VOIDED' },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          productId: SERIAL_PRODUCT_ID,
          inventoryUnitId: UNIT_ID,
          type: 'PURCHASE_CANCEL',
          quantityChange: -1,
          referenceType: 'PURCHASE',
          referenceId: 'purchase-1',
          reason: 'Bought from the wrong supplier',
        }),
      });
    });

    it('blocks the cancel when a phone from it is not IN_STOCK', async () => {
      tx.purchaseItem.findMany.mockResolvedValue(phoneLine);
      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM purchases')) return [{ status: 'ACTIVE' }];
        if (sql.includes('FROM inventory_units'))
          return [{ id: UNIT_ID, status: 'SOLD', imei1: '111223344556677' }];
        return [];
      });

      await expect(
        service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.inventoryUnit.update).not.toHaveBeenCalled();
      expect(tx.purchase.update).not.toHaveBeenCalled();
    });

    it('takes accessories off the shelf with a PURCHASE_CANCEL movement', async () => {
      tx.purchaseItem.findMany.mockResolvedValue(accessoryLine);

      await service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID);

      expect(tx.stockLevel.update).toHaveBeenCalledWith({
        where: { productId: QUANTITY_PRODUCT_ID },
        data: { quantityOnHand: 35 },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'PURCHASE_CANCEL',
          quantityChange: -5,
          referenceType: 'PURCHASE',
          referenceId: 'purchase-1',
        }),
      });
    });

    it('blocks the cancel when accessory stock would go negative', async () => {
      tx.purchaseItem.findMany.mockResolvedValue(accessoryLine);
      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM purchases')) return [{ status: 'ACTIVE' }];
        if (sql.includes('stock_levels')) return [{ quantity_on_hand: 2 }];
        return [];
      });

      await expect(
        service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.stockLevel.update).not.toHaveBeenCalled();
      expect(tx.purchase.update).not.toHaveBeenCalled();
    });

    it("cancels the bill's supplier payments with a REVERSAL IN each", async () => {
      tx.supplierPayment.findMany.mockResolvedValue([
        { id: 'sp-1', amount: 500000n },
      ]);

      await service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID);

      expect(tx.supplierPayment.update).toHaveBeenCalledWith({
        where: { id: 'sp-1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Bought from the wrong supplier',
          cancelledById: USER_ID,
        }),
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'REVERSAL',
          direction: 'IN',
          amount: 500000n,
          referenceType: 'SUPPLIER_PAYMENT',
          referenceId: 'sp-1',
          reversesMovementId: 'cm-original-1',
        }),
      });
    });

    it("falls back to the purchase's own cash row for WF6's paidNow payment", async () => {
      tx.supplierPayment.findMany.mockResolvedValue([
        { id: 'sp-1', amount: 500000n },
      ]);
      tx.cashMovement.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'cm-purchase' });

      await service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID);

      expect(
        tx.cashMovement.create.mock.calls[0][0].data.reversesMovementId,
      ).toBe('cm-purchase');
    });

    it('404s when the purchase belongs to another shop', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the purchase is already cancelled', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue({
        ...activePurchase,
        status: 'CANCELLED',
      });

      await expect(
        service.cancelPurchase('purchase-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getCancelImpact', () => {
    const impactPurchase = {
      id: 'purchase-1',
      purchaseNo: 'P-0002',
      status: 'ACTIVE',
      totalAmount: 400000n,
      supplierId: SUPPLIER_ID,
      isOpeningStock: false,
      items: [
        {
          productId: SERIAL_PRODUCT_ID,
          quantity: 1,
          product: { name: 'Samsung A15', trackingType: 'SERIALIZED' },
          inventoryUnits: [
            { imei1: '111111111111111', status: 'IN_STOCK' },
            { imei1: '222222222222222', status: 'IN_STOCK' },
          ],
        },
        {
          productId: QUANTITY_PRODUCT_ID,
          quantity: 3,
          product: { name: 'Clear Case', trackingType: 'QUANTITY' },
          inventoryUnits: [],
        },
      ],
    };

    beforeEach(() => {
      prismaStub.purchase.findFirst.mockResolvedValue(impactPurchase);
      prismaStub.stockLevel.findFirst.mockResolvedValue({
        quantityOnHand: 10n,
      });
      prismaStub.supplierPayment.findMany.mockResolvedValue([
        { amount: 200000n },
      ]);
      prismaStub.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: {
            amount: args.where.direction === 'IN' ? 500000n : 100000n,
          },
        }),
      );
      prismaStub.supplier.findFirst.mockResolvedValue({
        openingBalance: 300000n,
      });
      prismaStub.purchase.aggregate.mockResolvedValue({
        _sum: { totalAmount: 1000000n },
      });
      prismaStub.supplierPayment.aggregate.mockResolvedValue({
        _sum: { amount: 500000n },
      });
    });

    it('shows stock leaving, cash coming back and the payable after, writing nothing', async () => {
      const res = await service.getCancelImpact('purchase-1', SHOP_ID);

      expect(res).toMatchObject({
        recordType: 'PURCHASE',
        recordNo: 'P-0002',
        currentCash: 400000,
        cashReversedAmount: 200000,
        cashReversedDirection: 'IN',
        cashAfter: 600000,
        willCauseOverdraft: false,
        // payable 300000 + 1000000 − 500000 = 800000, minus this bill
        // 400000, plus its 200000 payment back = 600000.
        supplierPayableAfter: 600000,
        customerUdharAfter: null,
        blocked: false,
        blockedReason: null,
      });
      expect(res.stockItems).toEqual([
        {
          productName: 'Samsung A15',
          imei: '111111111111111',
          quantityChange: -1,
        },
        {
          productName: 'Samsung A15',
          imei: '222222222222222',
          quantityChange: -1,
        },
        { productName: 'Clear Case', imei: null, quantityChange: -3 },
      ]);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('marks the preview blocked when a phone is no longer IN_STOCK', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue({
        ...impactPurchase,
        items: [
          {
            ...impactPurchase.items[0],
            inventoryUnits: [{ imei1: '111111111111111', status: 'SOLD' }],
          },
        ],
      });

      const res = await service.getCancelImpact('purchase-1', SHOP_ID);

      expect(res.blocked).toBe(true);
      expect(res.blockedReason).toContain('111111111111111');
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('marks the preview blocked when accessory stock is short', async () => {
      prismaStub.stockLevel.findFirst.mockResolvedValue({
        quantityOnHand: 1n,
      });
      prismaStub.purchase.findFirst.mockResolvedValue({
        ...impactPurchase,
        items: [impactPurchase.items[1]],
      });

      const res = await service.getCancelImpact('purchase-1', SHOP_ID);

      expect(res.blocked).toBe(true);
      expect(res.blockedReason).toContain('Clear Case');
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the purchase is already cancelled', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue({
        ...impactPurchase,
        status: 'CANCELLED',
      });

      await expect(
        service.getCancelImpact('purchase-1', SHOP_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the purchase belongs to another shop', async () => {
      prismaStub.purchase.findFirst.mockResolvedValue(null);

      await expect(
        service.getCancelImpact('purchase-1', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });
});

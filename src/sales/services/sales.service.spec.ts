import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { SalesService } from './sales.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';
const CUSTOMER_ID = '01924f0a-0000-7000-8000-0000000000a7';
const QUANTITY_PRODUCT_ID = '01924f0a-0000-7000-8000-0000000000b1';
const SERIAL_PRODUCT_ID = '01924f0a-0000-7000-8000-0000000000b2';
const UNIT_ID = '01924f0a-0000-7000-8000-000000000301';

const prismaStub = {
  sale: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  customer: { findFirst: jest.fn() },
  product: { findMany: jest.fn() },
  payment: { findMany: jest.fn(), aggregate: jest.fn() },
  saleReturn: { count: jest.fn(), aggregate: jest.fn() },
  refund: { aggregate: jest.fn() },
  cashMovement: { aggregate: jest.fn() },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  sale: { create: jest.Mock; update: jest.Mock };
  saleItem: { create: jest.Mock; findMany: jest.Mock };
  inventoryUnit: { update: jest.Mock };
  inventoryMovement: { create: jest.Mock };
  stockLevel: { update: jest.Mock; create: jest.Mock };
  payment: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  saleReturn: { count: jest.Mock };
  cashMovement: {
    create: jest.Mock;
    findFirst: jest.Mock;
    aggregate: jest.Mock;
  };
}

/**
 * $queryRaw call order in createSale: [0] counter UPDATE ... RETURNING,
 * then per phone line a unit lock, per quantity line a stock lock.
 */
function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  const tx: TxStub = {
    $queryRaw: jest.fn().mockResolvedValue([{ next: 7 }]),
    sale: {
      create: jest.fn().mockResolvedValue({ id: 'sale-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    saleItem: {
      create: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve({ id: `item-${args.data.productId}` }),
        ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    inventoryUnit: { update: jest.fn().mockResolvedValue({}) },
    inventoryMovement: { create: jest.fn().mockResolvedValue({ id: 'm-1' }) },
    stockLevel: {
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    payment: {
      create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    // No returns against the sale by default (WF15 re-check runs in-tx).
    saleReturn: { count: jest.fn().mockResolvedValue(0) },
    cashMovement: {
      create: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'cm-original-1' }),
      // Plenty of opening cash by default so ordinary flows never prompt.
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

function serialiseSaleRequest(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: '01924f0a-0000-7000-8000-00000000beef',
    saleDate: '2026-10-07',
    // Default = walk-in full-cash accessory sale (2 × 80000 = 160000).
    paidNow: 160000,
    items: [
      {
        productId: QUANTITY_PRODUCT_ID,
        quantity: 2,
        unitPrice: 80000,
      },
    ],
    ...overrides,
  } as any;
}

describe('SalesService', () => {
  let service: SalesService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.sale.findFirst.mockResolvedValue(null);
    prismaStub.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID });
    prismaStub.saleReturn.count.mockResolvedValue(0);
    prismaStub.saleReturn.aggregate.mockResolvedValue({
      _sum: { returnAmount: null },
    });
    prismaStub.refund.aggregate.mockResolvedValue({ _sum: { amount: null } });
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
    // Stock lock returns the second queryRaw result (the counter is first).
    tx.$queryRaw.mockImplementation((strings: any) =>
      Promise.resolve(
        strings?.[0]?.includes('stock_levels')
          ? [{ quantity_on_hand: 10, avg_unit_cost: 50000n }]
          : [{ next: 7 }],
      ),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSale — totals and money', () => {
    it('computes subtotal and total from the lines and never reads them from the client', async () => {
      await service.createSale(
        serialiseSaleRequest({ subtotal: 1, totalAmount: 1 }),
        SHOP_ID,
        USER_ID,
      );

      const saleData = tx.sale.create.mock.calls[0][0].data;
      expect(saleData.subtotal).toBe(160000n);
      expect(saleData.discount).toBe(0n);
      expect(saleData.totalAmount).toBe(160000n);
    });

    it('applies the sale-level discount server-side', async () => {
      await service.createSale(
        serialiseSaleRequest({ discount: 10000, paidNow: 150000 }),
        SHOP_ID,
        USER_ID,
      );

      const saleData = tx.sale.create.mock.calls[0][0].data;
      expect(saleData.subtotal).toBe(160000n);
      expect(saleData.discount).toBe(10000n);
      expect(saleData.totalAmount).toBe(150000n);
      expect(tx.payment.create).toHaveBeenCalledTimes(1);
    });

    it('rejects a discount bigger than the subtotal', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({
            discount: 999999999,
            customerId: CUSTOMER_ID,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a paid amount larger than the sale total', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({ paidNow: 999999999, customerId: CUSTOMER_ID }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('writes no payment and no cash row for a full Udhar', async () => {
      await service.createSale(
        serialiseSaleRequest({ paidNow: 0, customerId: CUSTOMER_ID }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('writes a payment and an IN cash row for a part payment', async () => {
      await service.createSale(
        serialiseSaleRequest({ paidNow: 50000, customerId: CUSTOMER_ID }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopId: SHOP_ID,
            customerId: CUSTOMER_ID,
            saleId: 'sale-1',
            amount: 50000n,
          }),
        }),
      );
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'CUSTOMER_PAYMENT',
          direction: 'IN',
          amount: 50000n,
          referenceType: 'PAYMENT',
          referenceId: 'payment-1',
        }),
      });
    });

    it('stores blank notes as null instead of an empty string', async () => {
      await service.createSale(
        serialiseSaleRequest({ notes: '   ' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.sale.create.mock.calls[0][0].data.notes).toBeNull();
    });
  });

  describe('createSale — customer rules', () => {
    it('rejects a walk-in sale that leaves an unpaid balance', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({ paidNow: 0 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a walk-in phone sale even when fully paid', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({
            items: [
              {
                productId: SERIAL_PRODUCT_ID,
                quantity: 1,
                unitPrice: 10000000,
                inventoryUnitId: UNIT_ID,
              },
            ],
            paidNow: 10000000,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('allows a walk-in full-cash accessory sale with no customer', async () => {
      const res = await service.createSale(
        serialiseSaleRequest({ paidNow: 160000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Sale created successfully',
      });
      expect(tx.sale.create.mock.calls[0][0].data.customerId).toBeNull();
      expect(tx.payment.create.mock.calls[0][0].data.customerId).toBeNull();
    });

    it('404s on a customer that belongs to another shop', async () => {
      prismaStub.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.createSale(
          serialiseSaleRequest({ customerId: CUSTOMER_ID }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.customer.findFirst).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID, shopId: SHOP_ID },
        select: { id: true },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createSale — the sale number counter', () => {
    it('read+increments next_sale_no to S-0007', async () => {
      await service.createSale(serialiseSaleRequest(), SHOP_ID, USER_ID);

      const counterSql = tx.$queryRaw.mock.calls[0][0] as string[];
      expect(counterSql.join('')).toContain('next_sale_no');
      expect(tx.sale.create.mock.calls[0][0].data.saleNo).toBe('S-0007');
    });
  });

  describe('createSale — idempotency', () => {
    it('returns "already saved" without opening a transaction when the clientRequestId exists', async () => {
      prismaStub.sale.findFirst.mockResolvedValue({ id: 'sale-1' });

      const res = await service.createSale(
        serialiseSaleRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Sale already saved',
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it('scopes the idempotency lookup to the shop', async () => {
      prismaStub.sale.findFirst.mockResolvedValue({ id: 'sale-1' });

      await service.createSale(serialiseSaleRequest(), SHOP_ID, USER_ID);

      expect(prismaStub.sale.findFirst).toHaveBeenCalledWith({
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
                constraint: { index: 'sales_shop_id_client_request_id_key' },
                table: 'sales',
              },
            },
          },
        }),
      );

      const res = await service.createSale(
        serialiseSaleRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Sale already saved',
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
                constraint: { index: 'sales_shop_id_sale_no_key' },
                table: 'sales',
              },
            },
          },
        }),
      );

      await expect(
        service.createSale(serialiseSaleRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('createSale — phone lines', () => {
    const phoneLine = {
      productId: SERIAL_PRODUCT_ID,
      quantity: 1,
      unitPrice: 10000000,
      inventoryUnitId: UNIT_ID,
    };

    function lockUnitResult(overrides: Record<string, unknown> = {}) {
      return Promise.resolve([
        {
          id: UNIT_ID,
          status: 'IN_STOCK',
          imei1: '111',
          unit_cost: 9000000n,
          ...overrides,
        },
      ]);
    }

    it('locks the unit, snapshots cost, flips it to SOLD and appends a SALE movement', async () => {
      tx.$queryRaw.mockImplementation((strings: any) =>
        strings?.[0]?.includes('inventory_units')
          ? lockUnitResult()
          : Promise.resolve([{ next: 7 }]),
      );

      await service.createSale(
        serialiseSaleRequest({
          items: [phoneLine],
          paidNow: 10000000,
          customerId: CUSTOMER_ID,
        }),
        SHOP_ID,
        USER_ID,
      );

      const lockCall = tx.$queryRaw.mock.calls.find((c) =>
        (c[0] as string[]).join('').includes('inventory_units'),
      );
      expect(lockCall?.[0].join('')).toContain('FOR UPDATE');
      expect(lockCall?.[1]).toBe(UNIT_ID);

      expect(tx.saleItem.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          inventoryUnitId: UNIT_ID,
          quantity: 1,
          unitCost: 9000000n,
          total: 10000000n,
        }),
      );
      expect(tx.inventoryUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_ID },
        data: { status: 'SOLD' },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'SALE',
          quantityChange: -1,
          inventoryUnitId: UNIT_ID,
          referenceType: 'SALE',
          referenceId: 'sale-1',
        }),
      });
      expect(tx.stockLevel.update).not.toHaveBeenCalled();
    });

    it('rejects a unit that is already SOLD', async () => {
      tx.$queryRaw.mockImplementation((strings: any) =>
        strings?.[0]?.includes('inventory_units')
          ? lockUnitResult({ status: 'SOLD' })
          : Promise.resolve([{ next: 7 }]),
      );

      await expect(
        service.createSale(
          serialiseSaleRequest({
            items: [phoneLine],
            paidNow: 10000000,
            customerId: CUSTOMER_ID,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.sale.create).not.toHaveBeenCalled();
    });

    it('404s on a unit that belongs to another shop or product', async () => {
      tx.$queryRaw.mockImplementation((strings: any) =>
        strings?.[0]?.includes('inventory_units')
          ? Promise.resolve([])
          : Promise.resolve([{ next: 7 }]),
      );

      await expect(
        service.createSale(
          serialiseSaleRequest({
            items: [phoneLine],
            paidNow: 10000000,
            customerId: CUSTOMER_ID,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a phone line without inventoryUnitId', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({
            items: [
              {
                productId: SERIAL_PRODUCT_ID,
                quantity: 1,
                unitPrice: 10000000,
              },
            ],
            customerId: CUSTOMER_ID,
            paidNow: 10000000,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a phone line with quantity other than 1', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({
            items: [{ ...phoneLine, quantity: 2 }],
            customerId: CUSTOMER_ID,
            paidNow: 20000000,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects the same unit listed twice in one request', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({
            items: [phoneLine, { ...phoneLine }],
            customerId: CUSTOMER_ID,
            paidNow: 20000000,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects inventoryUnitId on a quantity-tracked accessory', async () => {
      await expect(
        service.createSale(
          serialiseSaleRequest({
            items: [
              {
                productId: QUANTITY_PRODUCT_ID,
                quantity: 1,
                unitPrice: 80000,
                inventoryUnitId: UNIT_ID,
              },
            ],
            paidNow: 80000,
          }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createSale — quantity stock', () => {
    it('locks the stock row, decrements and writes a SALE movement', async () => {
      await service.createSale(serialiseSaleRequest(), SHOP_ID, USER_ID);

      const lockCall = tx.$queryRaw.mock.calls.find((c) =>
        (c[0] as string[]).join('').includes('stock_levels'),
      );
      expect(lockCall?.[0].join('')).toContain('FOR UPDATE');

      expect(tx.stockLevel.update).toHaveBeenCalledWith({
        where: { productId: QUANTITY_PRODUCT_ID },
        data: { quantityOnHand: 8 },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'SALE',
          quantityChange: -2,
          referenceType: 'SALE',
          referenceId: 'sale-1',
        }),
      });
      expect(tx.saleItem.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({
          unitCost: 50000n,
          unitPrice: 80000n,
          total: 160000n,
        }),
      );
    });

    it('rejects selling more than the shelf holds', async () => {
      tx.$queryRaw.mockImplementation((strings: any) =>
        strings?.[0]?.includes('stock_levels')
          ? Promise.resolve([{ quantity_on_hand: 1, avg_unit_cost: 50000n }])
          : Promise.resolve([{ next: 7 }]),
      );

      await expect(
        service.createSale(serialiseSaleRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.saleItem.create).not.toHaveBeenCalled();
    });

    it('rejects selling a product with no stock row at all', async () => {
      tx.$queryRaw.mockImplementation((strings: any) =>
        strings?.[0]?.includes('stock_levels')
          ? Promise.resolve([])
          : Promise.resolve([{ next: 7 }]),
      );

      await expect(
        service.createSale(serialiseSaleRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createSale — tenant isolation', () => {
    it('404s on a product that belongs to another shop', async () => {
      prismaStub.product.findMany.mockResolvedValue([]);

      await expect(
        service.createSale(serialiseSaleRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.product.findMany).toHaveBeenCalledWith({
        where: { id: { in: [QUANTITY_PRODUCT_ID] }, shopId: SHOP_ID },
        select: { id: true, name: true, trackingType: true },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getSales', () => {
    it('scopes the list to the shop from the JWT', async () => {
      prismaStub.sale.findMany.mockResolvedValue([]);
      prismaStub.sale.count.mockResolvedValue(0);

      await service.getSales({ page: 1, pageSize: 10 }, SHOP_ID);

      const where = prismaStub.sale.findMany.mock.calls[0][0].where;
      expect(where.shopId).toBe(SHOP_ID);
      expect(prismaStub.sale.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID },
      });
    });

    it('filters by customer and status', async () => {
      prismaStub.sale.findMany.mockResolvedValue([]);
      prismaStub.sale.count.mockResolvedValue(0);

      await service.getSales(
        {
          page: 1,
          pageSize: 10,
          customerId: CUSTOMER_ID,
          status: 'ACTIVE',
        } as any,
        SHOP_ID,
      );

      expect(prismaStub.sale.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          shopId: SHOP_ID,
          customerId: CUSTOMER_ID,
          status: 'ACTIVE',
        }),
      );
    });

    it('ANDs the saleDate range instead of overwriting it', async () => {
      prismaStub.sale.findMany.mockResolvedValue([]);
      prismaStub.sale.count.mockResolvedValue(0);

      await service.getSales(
        {
          page: 1,
          pageSize: 10,
          from: '2026-10-01',
          to: '2026-10-31',
          search: 'S-0001',
        },
        SHOP_ID,
      );

      const where = prismaStub.sale.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.OR).toHaveLength(2);
      expect(where.shopId).toBe(SHOP_ID);
    });
  });

  describe('getSaleById', () => {
    it('404s when the sale belongs to another shop', async () => {
      prismaStub.sale.findFirst.mockResolvedValue(null);

      await expect(
        service.getSaleById('sale-1', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.sale.findFirst).toHaveBeenCalledWith({
        where: { id: 'sale-1', shopId: SHOP_ID },
        include: expect.anything(),
      });
    });

    it('maps BigInt money to plain numbers and resolves customer, IMEI and payments', async () => {
      prismaStub.sale.findFirst.mockResolvedValue({
        id: 'sale-1',
        shopId: SHOP_ID,
        customerId: CUSTOMER_ID,
        customer: { name: 'Ali Khan' },
        saleNo: 'S-0002',
        saleDate: new Date('2026-10-07T00:00:00.000Z'),
        subtotal: 10000000n,
        discount: 0n,
        totalAmount: 10000000n,
        dueDate: new Date('2026-10-15T00:00:00.000Z'),
        status: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        cancelledById: null,
        clientRequestId: 'req-1',
        notes: null,
        createdById: USER_ID,
        createdAt: new Date('2026-10-07T09:20:00.000Z'),
        updatedAt: new Date('2026-10-07T09:20:00.000Z'),
        items: [
          {
            id: 'item-1',
            productId: SERIAL_PRODUCT_ID,
            product: { name: 'Samsung A15' },
            inventoryUnitId: UNIT_ID,
            inventoryUnit: { imei1: '111223344556677' },
            quantity: 1,
            unitPrice: 10000000n,
            unitCost: 9000000n,
            total: 10000000n,
          },
        ],
        payments: [
          {
            id: 'payment-1',
            amount: 5000000n,
            paymentDate: new Date('2026-10-07T09:20:00.000Z'),
            method: 'CASH',
            status: 'ACTIVE',
          },
        ],
        saleReturns: [
          {
            id: 'ret-1',
            saleId: 'sale-1',
            customerId: CUSTOMER_ID,
            returnDate: new Date('2026-10-08T10:00:00.000Z'),
            reason: 'Wrong charger',
            returnAmount: 200000n,
            status: 'ACTIVE',
            notes: null,
            createdById: USER_ID,
            createdAt: new Date('2026-10-08T10:00:00.000Z'),
            updatedAt: new Date('2026-10-08T10:00:00.000Z'),
            items: [
              {
                id: 'ret-item-1',
                saleItemId: 'item-1',
                inventoryUnitId: null,
                quantity: 1,
                condition: 'GOOD',
                saleItem: {
                  productId: SERIAL_PRODUCT_ID,
                  product: { name: 'Samsung A15' },
                  inventoryUnit: { imei1: '111223344556677' },
                },
              },
            ],
            refunds: [
              {
                id: 'ref-1',
                amount: 200000n,
                refundDate: new Date('2026-10-08T10:00:00.000Z'),
                method: 'CASH',
                notes: null,
              },
            ],
          },
        ],
      });

      const res = await service.getSaleById('sale-1', SHOP_ID);

      expect(res.saleNo).toBe('S-0002');
      expect(res.customerName).toBe('Ali Khan');
      expect(res.totalAmount).toBe(10000000);
      expect(res.dueDate).toBe('2026-10-15');
      expect(res.items[0].imei).toBe('111223344556677');
      expect(res.items[0].unitCost).toBe(9000000);
      expect(res.payments[0].amount).toBe(5000000);
      // WF15: the sale carries its returns, header fields filled from the
      // parent sale (there is no sale join on the way back up).
      expect(res.returns).toHaveLength(1);
      expect(res.returns[0].saleNo).toBe('S-0002');
      expect(res.returns[0].returnAmount).toBe(200000);
      expect(res.returns[0].items[0].productName).toBe('Samsung A15');
      expect(res.returns[0].items[0].imei).toBe('111223344556677');
      expect(res.returns[0].refunds[0].amount).toBe(200000);
    });
  });

  describe('cancelSale — WF12', () => {
    const activeSale = { id: 'sale-1', status: 'ACTIVE', saleNo: 'S-0002' };
    const cancelDto = { cancelReason: 'Wrong IMEI' };
    const phoneLine = [
      {
        productId: SERIAL_PRODUCT_ID,
        inventoryUnitId: UNIT_ID,
        quantity: 1,
        product: { name: 'Samsung A15' },
      },
    ];
    const accessoryLine = [
      {
        productId: QUANTITY_PRODUCT_ID,
        inventoryUnitId: null,
        quantity: 2,
        product: { name: 'Samsung Charger' },
      },
    ];

    beforeEach(() => {
      prismaStub.sale.findFirst.mockResolvedValue(activeSale);
      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM sales')) return [{ status: 'ACTIVE' }];
        if (sql.includes('FROM inventory_units'))
          return [{ id: UNIT_ID, status: 'SOLD', imei1: '111223344556677' }];
        if (sql.includes('stock_levels')) return [{ quantity_on_hand: 3 }];
        return [];
      });
    });

    it('marks the sale CANCELLED with reason, time and user', async () => {
      const res = await service.cancelSale(
        'sale-1',
        cancelDto,
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Sale cancelled successfully',
      });
      expect(tx.sale.update).toHaveBeenCalledWith({
        where: { id: 'sale-1', shopId: SHOP_ID },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Wrong IMEI',
          cancelledById: USER_ID,
          cancelledAt: expect.any(Date),
        }),
      });
    });

    it('locks the sale row FOR UPDATE inside the transaction', async () => {
      await service.cancelSale('sale-1', cancelDto, SHOP_ID, USER_ID);

      const saleLock = tx.$queryRaw.mock.calls.find((call: any) =>
        call[0].join('').includes('FROM sales'),
      );
      expect(saleLock[0].join('')).toContain('FOR UPDATE');
    });

    it('puts a sold phone back IN_STOCK with a +1 SALE_CANCEL movement', async () => {
      tx.saleItem.findMany.mockResolvedValue(phoneLine);

      await service.cancelSale('sale-1', cancelDto, SHOP_ID, USER_ID);

      expect(tx.inventoryUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_ID },
        data: { status: 'IN_STOCK' },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          productId: SERIAL_PRODUCT_ID,
          inventoryUnitId: UNIT_ID,
          type: 'SALE_CANCEL',
          quantityChange: 1,
          referenceType: 'SALE',
          referenceId: 'sale-1',
          reason: 'Wrong IMEI',
        }),
      });
    });

    it('400s when the phone is not SOLD (nothing to put back)', async () => {
      tx.saleItem.findMany.mockResolvedValue(phoneLine);
      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM sales')) return [{ status: 'ACTIVE' }];
        if (sql.includes('FROM inventory_units'))
          return [{ id: UNIT_ID, status: 'VOIDED', imei1: '111223344556677' }];
        return [];
      });

      await expect(
        service.cancelSale('sale-1', cancelDto as any, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.sale.update).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('adds sold accessories back to the shelf with a +qty SALE_CANCEL movement', async () => {
      tx.saleItem.findMany.mockResolvedValue(accessoryLine);

      await service.cancelSale('sale-1', cancelDto, SHOP_ID, USER_ID);

      expect(tx.stockLevel.update).toHaveBeenCalledWith({
        where: { productId: QUANTITY_PRODUCT_ID },
        data: { quantityOnHand: 5 },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'SALE_CANCEL',
          quantityChange: 2,
          referenceType: 'SALE',
          referenceId: 'sale-1',
        }),
      });
    });

    it('cancels every ACTIVE payment of the sale with a REVERSAL OUT', async () => {
      tx.payment.findMany.mockResolvedValue([
        { id: 'payment-1', amount: 5000000n },
      ]);
      tx.cashMovement.findFirst.mockResolvedValue({ id: 'cm-original-1' });

      await service.cancelSale('sale-1', cancelDto, SHOP_ID, USER_ID);

      expect(tx.payment.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          shopId: SHOP_ID,
          saleId: 'sale-1',
          status: 'ACTIVE',
        }),
      );
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Wrong IMEI',
          cancelledById: USER_ID,
        }),
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'REVERSAL',
          direction: 'OUT',
          amount: 5000000n,
          referenceType: 'PAYMENT',
          referenceId: 'payment-1',
          reversesMovementId: 'cm-original-1',
          note: 'Wrong IMEI',
        }),
      });
    });

    it('returns a confirm prompt and writes nothing when refunds take cash below zero', async () => {
      tx.payment.findMany.mockResolvedValue([
        { id: 'payment-1', amount: 5000000n },
      ]);
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 300000n : 0n },
        }),
      );

      const res = await service.cancelSale(
        'sale-1',
        { ...cancelDto },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(
        expect.objectContaining({ confirmOverdraft: true, shortfall: 4700000 }),
      );
      expect(res.message).toContain('sale cancellation');
      expect(tx.sale.update).not.toHaveBeenCalled();
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('cancels anyway with isOverdraft true once confirmOverdraft is sent', async () => {
      tx.payment.findMany.mockResolvedValue([
        { id: 'payment-1', amount: 5000000n },
      ]);
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 300000n : 0n },
        }),
      );

      const res = await service.cancelSale(
        'sale-1',
        { ...cancelDto, confirmOverdraft: true },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Sale cancelled successfully',
      });
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        true,
      );
      expect(tx.sale.update).toHaveBeenCalled();
    });

    it('404s when the sale belongs to another shop', async () => {
      prismaStub.sale.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelSale('sale-1', cancelDto as any, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the sale is already cancelled', async () => {
      prismaStub.sale.findFirst.mockResolvedValue({
        ...activeSale,
        status: 'CANCELLED',
      });

      await expect(
        service.cancelSale('sale-1', cancelDto as any, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the sale already has returns, writing nothing (WF15)', async () => {
      prismaStub.saleReturn.count.mockResolvedValue(2);

      await expect(
        service.cancelSale('sale-1', cancelDto as any, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.saleReturn.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID, saleId: 'sale-1', status: 'ACTIVE' },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
      expect(tx.sale.update).not.toHaveBeenCalled();
    });

    it('refuses a return that races the cancel, inside the tx too (WF15)', async () => {
      // The pre-check sees no returns; a return lands before the lock.
      prismaStub.saleReturn.count.mockResolvedValue(0);
      tx.saleReturn.count.mockResolvedValue(1);

      await expect(
        service.cancelSale('sale-1', cancelDto as any, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.sale.update).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('404s when a payment has no original cash movement, writing nothing', async () => {
      tx.payment.findMany.mockResolvedValue([
        { id: 'payment-1', amount: 5000000n },
      ]);
      tx.cashMovement.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelSale('sale-1', cancelDto as any, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
      expect(tx.sale.update).not.toHaveBeenCalled();
    });
  });

  describe('getCancelImpact', () => {
    const impactSale = {
      id: 'sale-1',
      saleNo: 'S-0002',
      status: 'ACTIVE',
      totalAmount: 800000n,
      customerId: CUSTOMER_ID,
      items: [
        {
          inventoryUnitId: UNIT_ID,
          quantity: 1,
          product: { name: 'Samsung A15' },
          inventoryUnit: { imei1: '111111111111111', status: 'SOLD' },
        },
        {
          inventoryUnitId: null,
          quantity: 2,
          product: { name: 'Clear Case' },
          inventoryUnit: null,
        },
      ],
    };

    beforeEach(() => {
      prismaStub.sale.findFirst.mockResolvedValue(impactSale);
      prismaStub.payment.findMany.mockResolvedValue([{ amount: 500000n }]);
      prismaStub.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 1000000n : 0n },
        }),
      );
      prismaStub.customer.findFirst.mockResolvedValue({
        openingBalance: 100000n,
      });
      prismaStub.sale.aggregate.mockResolvedValue({
        _sum: { totalAmount: 800000n },
      });
      prismaStub.payment.aggregate.mockResolvedValue({
        _sum: { amount: 200000n },
      });
    });

    it('shows stock back, cash reversed and the Udhar after, writing nothing', async () => {
      const res = await service.getCancelImpact('sale-1', SHOP_ID);

      expect(res).toMatchObject({
        recordType: 'SALE',
        recordId: 'sale-1',
        recordNo: 'S-0002',
        currentCash: 1000000,
        cashReversedAmount: 500000,
        cashReversedDirection: 'OUT',
        cashAfter: 500000,
        willCauseOverdraft: false,
        // balance 100000 + 800000 − 200000 = 700000, minus the cancelled
        // sale 800000, plus its 500000 payment back = 400000.
        customerUdharAfter: 400000,
        supplierPayableAfter: null,
        blocked: false,
        blockedReason: null,
      });
      expect(res.stockItems).toEqual([
        {
          productName: 'Samsung A15',
          imei: '111111111111111',
          quantityChange: 1,
        },
        { productName: 'Clear Case', imei: null, quantityChange: 2 },
      ]);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('marks the preview blocked when a phone is no longer SOLD', async () => {
      prismaStub.sale.findFirst.mockResolvedValue({
        ...impactSale,
        items: [
          {
            ...impactSale.items[0],
            inventoryUnit: { imei1: '111111111111111', status: 'DAMAGED' },
          },
        ],
      });

      const res = await service.getCancelImpact('sale-1', SHOP_ID);

      expect(res.blocked).toBe(true);
      expect(res.blockedReason).toContain('111111111111111');
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the sale is already cancelled', async () => {
      prismaStub.sale.findFirst.mockResolvedValue({
        ...impactSale,
        status: 'CANCELLED',
      });

      await expect(
        service.getCancelImpact('sale-1', SHOP_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('marks the preview blocked when the sale already has returns (WF15)', async () => {
      prismaStub.saleReturn.count.mockResolvedValue(1);

      const res = await service.getCancelImpact('sale-1', SHOP_ID);

      expect(res.blocked).toBe(true);
      expect(res.blockedReason).toContain('S-0002');
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the sale belongs to another shop', async () => {
      prismaStub.sale.findFirst.mockResolvedValue(null);

      await expect(
        service.getCancelImpact('sale-1', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });
});

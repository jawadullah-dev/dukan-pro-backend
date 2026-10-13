import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReturnsService } from './returns.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';
const CUSTOMER_ID = '01924f0a-0000-7000-8000-0000000000a7';
const SALE_ID = '01924f0a-0000-7000-8000-0000000000aa';
const PHONE_ITEM_ID = '01924f0a-0000-7000-8000-000000000201';
const ACC_ITEM_ID = '01924f0a-0000-7000-8000-000000000202';
const PHONE_ID = '01924f0a-0000-7000-8000-000000000101';
const ACC_ID = '01924f0a-0000-7000-8000-000000000102';
const UNIT_ID = '01924f0a-0000-7000-8000-000000000301';
const IMEI = '111223344556677';

const prismaStub = {
  sale: { findFirst: jest.fn() },
  payment: { aggregate: jest.fn() },
  saleReturn: { findMany: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
  refund: { aggregate: jest.fn() },
  returnItem: { findMany: jest.fn() },
  cashMovement: { aggregate: jest.fn() },
  $transaction: jest.fn(),
};

/**
 * The sale every test starts from:
 * phone 1 × 8,000,000 + accessory 2 × 1,000,000 = subtotal 10,000,000,
 * discount 1,000,000, total 9,000,000.
 */
function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SALE_ID,
    saleNo: 'S-0001',
    status: 'ACTIVE',
    subtotal: 10000000n,
    discount: 1000000n,
    totalAmount: 9000000n,
    customerId: CUSTOMER_ID,
    customer: { name: 'Ali Khan' },
    items: [
      {
        id: PHONE_ITEM_ID,
        productId: PHONE_ID,
        inventoryUnitId: UNIT_ID,
        quantity: 1,
        unitPrice: 8000000n,
        product: { name: 'Samsung A15' },
        inventoryUnit: { imei1: IMEI, status: 'SOLD' },
      },
      {
        id: ACC_ITEM_ID,
        productId: ACC_ID,
        inventoryUnitId: null,
        quantity: 2,
        unitPrice: 1000000n,
        product: { name: 'Samsung Charger' },
        inventoryUnit: null,
      },
    ],
    ...overrides,
  };
}

interface TxStub {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  sale: { findFirst: jest.Mock; update: jest.Mock };
  saleReturn: {
    create: jest.Mock;
    findMany: jest.Mock;
    aggregate: jest.Mock;
  };
  returnItem: { create: jest.Mock; findMany: jest.Mock };
  payment: { aggregate: jest.Mock };
  refund: { create: jest.Mock; aggregate: jest.Mock; findMany: jest.Mock };
  cashMovement: { create: jest.Mock; aggregate: jest.Mock };
  inventoryUnit: { update: jest.Mock };
  inventoryMovement: { create: jest.Mock };
  stockLevel: { update: jest.Mock; create: jest.Mock };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  let seq = 0;
  const tx: TxStub = {
    // Dispatch on the SQL: the shop lock, the sale row re-check, then the
    // per-line unit / stock locks inside restoreLine/writeOffLine.
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('FROM shops')) return Promise.resolve([{ id: SHOP_ID }]);
      if (sql.includes('SELECT status FROM sales'))
        return Promise.resolve([{ status: 'ACTIVE' }]);
      if (sql.includes('FROM inventory_units'))
        return Promise.resolve([{ id: UNIT_ID, status: 'SOLD', imei1: IMEI }]);
      if (sql.includes('FROM stock_levels'))
        return Promise.resolve([{ quantity_on_hand: 10 }]);
      return Promise.resolve([]);
    }),
    $executeRaw: jest.fn().mockResolvedValue(1),
    sale: {
      findFirst: jest.fn().mockResolvedValue(saleRow()),
      update: jest.fn().mockResolvedValue({}),
    },
    saleReturn: {
      create: jest.fn().mockResolvedValue({ id: 'ret-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { returnAmount: null } }),
    },
    returnItem: {
      create: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ id: `ret-item-${++seq}` })),
      findMany: jest.fn().mockResolvedValue([]),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
    },
    refund: {
      create: jest.fn().mockResolvedValue({ id: 'ref-1' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    cashMovement: {
      create: jest.fn().mockResolvedValue({ id: 'cm-refund-1' }),
      // Plenty of opening cash by default so ordinary flows never prompt.
      aggregate: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 100000000n : 0n },
        }),
      ),
    },
    inventoryUnit: { update: jest.fn().mockResolvedValue({}) },
    inventoryMovement: { create: jest.fn().mockResolvedValue({ id: 'm-1' }) },
    stockLevel: {
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  return tx;
}

/**
 * prepare() runs twice per save (fast fail on prisma, authoritative inside
 * the tx), so both stubs must answer the same settlement question.
 */
function primeSettlement(
  tx: TxStub,
  opts: { paid?: bigint; priorReturns?: bigint; refunds?: bigint } = {},
) {
  const paid = opts.paid ?? 0n;
  const priorReturns = opts.priorReturns ?? 0n;
  const refunds = opts.refunds ?? 0n;
  for (const db of [prismaStub, tx] as const) {
    db.payment.aggregate.mockResolvedValue({ _sum: { amount: paid } });
    db.saleReturn.aggregate.mockResolvedValue({
      _sum: { returnAmount: priorReturns },
    });
    db.refund.aggregate.mockResolvedValue({ _sum: { amount: refunds } });
  }
}

function returnRequest(overrides: Record<string, unknown> = {}) {
  return {
    reason: 'Customer bought the wrong charger',
    returnDate: '2026-10-08',
    items: [
      { saleItemId: PHONE_ITEM_ID, condition: 'GOOD' },
      { saleItemId: ACC_ITEM_ID, quantity: 2, condition: 'GOOD' },
    ],
    refundAmount: 0,
    ...overrides,
  } as any;
}

function previewRequest(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      { saleItemId: PHONE_ITEM_ID, condition: 'GOOD' },
      { saleItemId: ACC_ITEM_ID, quantity: 2, condition: 'GOOD' },
    ],
    ...overrides,
  } as any;
}

describe('ReturnsService', () => {
  let service: ReturnsService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<ReturnsService>(ReturnsService);

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.sale.findFirst.mockResolvedValue(saleRow());
    prismaStub.returnItem.findMany.mockResolvedValue([]);
    primeSettlement(tx, { paid: 9000000n });
    prismaStub.cashMovement.aggregate.mockImplementation((args: any) =>
      Promise.resolve({
        _sum: { amount: args.where.direction === 'IN' ? 100000000n : 0n },
      }),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('previewReturn — WF15 step 4 (dry run)', () => {
    it('settles the money and the cash picture without opening a transaction', async () => {
      const res = await service.previewReturn(
        SALE_ID,
        previewRequest({ refundAmount: 9000000 }),
        SHOP_ID,
      );

      // Full return: gross 10,000,000 − share of the 1,000,000 discount.
      expect(res.returnAmount).toBe(9000000);
      // total 9,000,000 − 0 returns − 9,000,000 paid + 0 refunds = 0.
      expect(res.outstandingBefore).toBe(0);
      // Refund cancels nothing owed, up to the cash actually paid.
      expect(res.refundable).toBe(9000000);
      expect(res.refundAmount).toBe(9000000);
      expect(res.outstandingAfter).toBe(0);
      expect(res.currentCash).toBe(100000000);
      expect(res.cashAfter).toBe(91000000); // cash leaves the drawer
      expect(res.willCauseOverdraft).toBe(false);
      expect(res.items).toHaveLength(2);
      expect(res.items[0].imei).toBe(IMEI);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
      expect(prismaStub.saleReturn.findMany).not.toHaveBeenCalled();
    });

    it('first cancels the Udhar, then caps the refund at what was paid', async () => {
      // Paid only 5,000,000 of the 9,000,000 bill before returning everything.
      primeSettlement(tx, { paid: 5000000n });

      const res = await service.previewReturn(
        SALE_ID,
        previewRequest({ refundAmount: 0 }),
        SHOP_ID,
      );

      expect(res.returnAmount).toBe(9000000);
      expect(res.outstandingBefore).toBe(4000000);
      // 9,000,000 − 4,000,000 of Udhar = 5,000,000 cash left to give —
      // exactly what was paid, so that is the cap either way.
      expect(res.refundable).toBe(5000000);

      await expect(
        service.previewReturn(
          SALE_ID,
          previewRequest({ refundAmount: 5000001 }),
          SHOP_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s a sale that belongs to another shop', async () => {
      prismaStub.sale.findFirst.mockResolvedValue(null);

      await expect(
        service.previewReturn(SALE_ID, previewRequest(), SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s a cancelled sale', async () => {
      prismaStub.sale.findFirst.mockResolvedValue(
        saleRow({ status: 'CANCELLED' }),
      );

      await expect(
        service.previewReturn(SALE_ID, previewRequest(), SHOP_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('line validation — WF15 step 2', () => {
    it('refuses returning more than sold minus already returned', async () => {
      prismaStub.returnItem.findMany.mockResolvedValue([
        { saleItemId: ACC_ITEM_ID, quantity: 1 },
      ]);

      await expect(
        service.previewReturn(
          SALE_ID,
          previewRequest({
            items: [
              { saleItemId: ACC_ITEM_ID, quantity: 2, condition: 'GOOD' },
            ],
          }),
          SHOP_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prismaStub.returnItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            saleItemId: { in: [ACC_ITEM_ID] },
            saleReturn: { saleId: SALE_ID, shopId: SHOP_ID, status: 'ACTIVE' },
          }),
        }),
      );
    });

    it('requires quantity on a quantity-tracked line', async () => {
      await expect(
        service.previewReturn(
          SALE_ID,
          previewRequest({
            items: [{ saleItemId: ACC_ITEM_ID, condition: 'GOOD' }],
          }),
          SHOP_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects quantity other than 1 on a phone line', async () => {
      await expect(
        service.previewReturn(
          SALE_ID,
          previewRequest({
            items: [
              { saleItemId: PHONE_ITEM_ID, quantity: 2, condition: 'GOOD' },
            ],
          }),
          SHOP_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a phone that was already returned', async () => {
      prismaStub.returnItem.findMany.mockResolvedValue([
        { saleItemId: PHONE_ITEM_ID, quantity: 1 },
      ]);

      await expect(
        service.previewReturn(
          SALE_ID,
          previewRequest({
            items: [{ saleItemId: PHONE_ITEM_ID, condition: 'GOOD' }],
          }),
          SHOP_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a phone that is no longer SOLD', async () => {
      const broken = saleRow();
      (broken.items[0] as any).inventoryUnit = {
        imei1: IMEI,
        status: 'DAMAGED',
      };
      prismaStub.sale.findFirst.mockResolvedValue(broken);

      await expect(
        service.previewReturn(
          SALE_ID,
          previewRequest({
            items: [{ saleItemId: PHONE_ITEM_ID, condition: 'GOOD' }],
          }),
          SHOP_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s a saleItemId that is not on this sale', async () => {
      await expect(
        service.previewReturn(
          SALE_ID,
          previewRequest({
            items: [
              {
                saleItemId: '01924f0a-0000-7000-8000-00000000dead',
                condition: 'GOOD',
              },
            ],
          }),
          SHOP_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createReturn — the save', () => {
    it('writes the return, restores stock and the refund in one transaction', async () => {
      const res = await service.createReturn(
        SALE_ID,
        returnRequest({ refundAmount: 9000000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Return recorded successfully',
      });
      expect(prismaStub.$transaction).toHaveBeenCalledTimes(1);

      expect(tx.saleReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            shopId: SHOP_ID,
            saleId: SALE_ID,
            customerId: CUSTOMER_ID,
            returnAmount: 9000000n,
            createdById: USER_ID,
          }),
        }),
      );
      expect(tx.returnItem.create).toHaveBeenCalledTimes(2);

      // GOOD: phone SOLD → IN_STOCK with +1, accessory shelf +2 with +2.
      expect(tx.inventoryUnit.update).toHaveBeenCalledWith({
        where: { id: UNIT_ID },
        data: { status: 'IN_STOCK' },
      });
      expect(tx.stockLevel.update).toHaveBeenCalledWith({
        where: { productId: ACC_ID },
        data: { quantityOnHand: 12 },
      });
      const movements = tx.inventoryMovement.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(movements).toEqual([
        expect.objectContaining({
          type: 'CUSTOMER_RETURN',
          quantityChange: 1,
          inventoryUnitId: UNIT_ID,
          referenceType: 'RETURN',
          referenceId: 'ret-1',
        }),
        expect.objectContaining({
          type: 'CUSTOMER_RETURN',
          quantityChange: 2,
          productId: ACC_ID,
          referenceType: 'RETURN',
          referenceId: 'ret-1',
        }),
      ]);

      expect(tx.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: 9000000n,
            refundDate: new Date('2026-10-08'),
            createdById: USER_ID,
          }),
        }),
      );
      expect(tx.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'REFUND',
            direction: 'OUT',
            amount: 9000000n,
            movementDate: new Date('2026-10-08'),
            referenceType: 'REFUND',
            referenceId: 'ref-1',
            isOverdraft: false,
          }),
        }),
      );

      // The sale row itself is history and is never touched.
      expect(tx.sale.update).not.toHaveBeenCalled();
    });

    it('keeps the whole return as Udhar relief when refundAmount is 0', async () => {
      const res = await service.createReturn(
        SALE_ID,
        returnRequest({ refundAmount: 0 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Return recorded successfully',
      });
      expect(tx.saleReturn.create).toHaveBeenCalledTimes(1);
      expect(tx.refund.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
      // No cash leaves, so the drawer balance is never even read.
      expect(tx.cashMovement.aggregate).not.toHaveBeenCalled();
    });

    it('rejects a refund larger than refundable before the transaction', async () => {
      await expect(
        service.createReturn(
          SALE_ID,
          returnRequest({ refundAmount: 9000001 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('prompts and writes nothing when the refund would go below zero', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: {
            amount: args.where.direction === 'IN' ? 100000000n : 95000000n,
          },
        }),
      );

      const res = await service.createReturn(
        SALE_ID,
        returnRequest({ refundAmount: 9000000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(
        expect.objectContaining({
          confirmOverdraft: true,
          shortfall: 4000000, // 5,000,000 cash − 9,000,000 refund
        }),
      );
      expect(tx.saleReturn.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
      // The tx still ran (locks happen first) but committed no rows.
      expect(prismaStub.$transaction).toHaveBeenCalledTimes(1);
    });

    it('saves with isOverdraft true once confirmOverdraft is sent', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: {
            amount: args.where.direction === 'IN' ? 100000000n : 95000000n,
          },
        }),
      );

      const res = await service.createReturn(
        SALE_ID,
        returnRequest({ refundAmount: 9000000, confirmOverdraft: true }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Return recorded successfully',
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isOverdraft: true }),
        }),
      );
    });

    it('takes a DAMAGED phone back off the shelf (restore then write-off)', async () => {
      await service.createReturn(
        SALE_ID,
        returnRequest({
          items: [
            { saleItemId: PHONE_ITEM_ID, condition: 'DAMAGED' },
            { saleItemId: ACC_ITEM_ID, quantity: 2, condition: 'GOOD' },
          ],
          refundAmount: 0,
        }),
        SHOP_ID,
        USER_ID,
      );

      // The unit ends where WF8 would have put it, via the pair of movements.
      expect(tx.inventoryUnit.update).toHaveBeenNthCalledWith(1, {
        where: { id: UNIT_ID },
        data: { status: 'IN_STOCK' },
      });
      expect(tx.inventoryUnit.update).toHaveBeenNthCalledWith(2, {
        where: { id: UNIT_ID },
        data: { status: 'DAMAGED' },
      });
      const movements = tx.inventoryMovement.create.mock.calls.map(
        (c: any[]) => c[0].data,
      );
      expect(movements.slice(0, 2)).toEqual([
        expect.objectContaining({ type: 'CUSTOMER_RETURN', quantityChange: 1 }),
        expect.objectContaining({ type: 'DAMAGED', quantityChange: -1 }),
      ]);
      // inventory_movements still sums to the sellable count: +1 −1 for the
      // phone, +2 for the accessory that stays on the shelf.
      const net = movements.reduce(
        (sum: number, m: any) => sum + m.quantityChange,
        0,
      );
      expect(net).toBe(2);
    });

    it('refuses when the sale flipped to CANCELLED under the lock', async () => {
      tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('FROM shops'))
          return Promise.resolve([{ id: SHOP_ID }]);
        if (sql.includes('SELECT status FROM sales'))
          return Promise.resolve([{ status: 'CANCELLED' }]);
        return Promise.resolve([]);
      });

      await expect(
        service.createReturn(SALE_ID, returnRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.saleReturn.create).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('getReturns / getReturnById', () => {
    const returnRow = {
      id: 'ret-1',
      saleId: SALE_ID,
      customerId: CUSTOMER_ID,
      returnDate: new Date('2026-10-08T00:00:00.000Z'),
      reason: 'Wrong charger',
      returnAmount: 9000000n,
      status: 'ACTIVE',
      notes: null,
      createdById: USER_ID,
      createdAt: new Date('2026-10-08T10:00:00.000Z'),
      updatedAt: new Date('2026-10-08T10:00:00.000Z'),
      sale: { saleNo: 'S-0001' },
      customer: { name: 'Ali Khan' },
      items: [
        {
          id: 'ret-item-1',
          saleItemId: PHONE_ITEM_ID,
          inventoryUnitId: UNIT_ID,
          quantity: 1,
          condition: 'GOOD',
          saleItem: {
            productId: PHONE_ID,
            product: { name: 'Samsung A15' },
            inventoryUnit: { imei1: IMEI },
          },
        },
      ],
      refunds: [
        {
          id: 'ref-1',
          amount: 4000000n,
          refundDate: new Date('2026-10-08T00:00:00.000Z'),
          method: 'CASH',
          notes: null,
        },
      ],
    };

    it('scopes the list to the shop and passes the filters through', async () => {
      prismaStub.saleReturn.findMany.mockResolvedValue([returnRow]);
      prismaStub.saleReturn.count.mockResolvedValue(1);

      const res = await service.getReturns(
        { saleId: SALE_ID, search: 'wrong', page: 1, pageSize: 10 },
        SHOP_ID,
      );

      expect(res.total).toBe(1);
      expect(res.items[0].saleNo).toBe('S-0001');
      expect(res.items[0].returnAmount).toBe(9000000);
      expect(res.items[0].items[0].imei).toBe(IMEI);
      expect(res.items[0].refunds[0].amount).toBe(4000000);
      expect(prismaStub.saleReturn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            shopId: SHOP_ID,
            saleId: SALE_ID,
            OR: expect.any(Array),
          }),
        }),
      );
      expect(prismaStub.saleReturn.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ shopId: SHOP_ID }),
        }),
      );
    });

    it('404s a return that belongs to another shop', async () => {
      prismaStub.saleReturn.findFirst = jest.fn().mockResolvedValue(null);

      await expect(
        service.getReturnById('ret-1', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

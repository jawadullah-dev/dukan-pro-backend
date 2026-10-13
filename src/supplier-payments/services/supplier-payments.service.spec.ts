import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SupplierPaymentsService } from './supplier-payments.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';
const SUPPLIER_ID = '01924f0a-0000-7000-8000-0000000000a1';
const PURCHASE_ID = '01924f0a-0000-7000-8000-0000000000c1';
const PAYMENT_ID = '01924f0a-0000-7000-8000-0000000000f1';

const prismaStub = {
  supplier: { findFirst: jest.fn() },
  supplierPayment: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  purchase: { findMany: jest.fn(), aggregate: jest.fn() },
  cashMovement: { aggregate: jest.fn() },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  purchase: { findFirst: jest.Mock };
  supplierPayment: {
    create: jest.Mock;
    aggregate: jest.Mock;
    update: jest.Mock;
  };
  cashMovement: {
    create: jest.Mock;
    aggregate: jest.Mock;
    findFirst: jest.Mock;
  };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  const tx: TxStub = {
    $queryRaw: jest.fn().mockResolvedValue([{ opening_balance: 5000000n }]),
    purchase: {
      findFirst: jest.fn().mockResolvedValue({
        id: PURCHASE_ID,
        purchaseNo: 'P-0003',
        supplierId: SUPPLIER_ID,
        totalAmount: 19000000n,
        status: 'ACTIVE',
        isOpeningStock: false,
      }),
    },
    supplierPayment: {
      create: jest.fn().mockResolvedValue({ id: 'sp-1' }),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
      update: jest.fn().mockResolvedValue({}),
    },
    cashMovement: {
      create: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'cm-original-1' }),
      // Plenty of cash by default so ordinary payments never prompt.
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

function paymentRequest(overrides: Record<string, unknown> = {}) {
  return {
    supplierId: SUPPLIER_ID,
    purchaseId: PURCHASE_ID,
    amount: 9000000,
    paymentDate: '2026-10-06',
    confirmOverdraft: false,
    ...overrides,
  } as any;
}

describe('SupplierPaymentsService', () => {
  let service: SupplierPaymentsService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierPaymentsService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<SupplierPaymentsService>(SupplierPaymentsService);

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.supplier.findFirst.mockResolvedValue({
      id: SUPPLIER_ID,
      name: 'ABC Mobiles',
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSupplierPayment — the write', () => {
    it('writes one supplier_payments row and one OUT cash row', async () => {
      const res = await service.createSupplierPayment(
        paymentRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Supplier payment recorded successfully',
      });
      expect(tx.supplierPayment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          supplierId: SUPPLIER_ID,
          purchaseId: PURCHASE_ID,
          amount: 9000000n,
          createdById: USER_ID,
        }),
        select: { id: true },
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          type: 'SUPPLIER_PAYMENT',
          direction: 'OUT',
          amount: 9000000n,
          referenceType: 'SUPPLIER_PAYMENT',
          referenceId: 'sp-1',
          isOverdraft: false,
        }),
      });
    });

    it('locks the shop row first, then the supplier, so cash reads and the outstanding check serialize', async () => {
      await service.createSupplierPayment(paymentRequest(), SHOP_ID, USER_ID);

      // Call 1 = shop-row FOR UPDATE (serialises the cash aggregate).
      const [shopStrings, shopArg] = tx.$queryRaw.mock.calls[0];
      expect(String(shopStrings)).toContain('FOR UPDATE');
      expect(shopArg).toBe(SHOP_ID);
      // Call 2 = supplier-row FOR UPDATE (serialises the outstanding check).
      const [supplierStrings, supplierArg, supplierShopArg] =
        tx.$queryRaw.mock.calls[1];
      expect(String(supplierStrings)).toContain('opening_balance');
      expect(supplierShopArg).toBe(SHOP_ID);
      expect(supplierArg).toBe(SUPPLIER_ID);
    });

    it('pays the opening balance when purchaseId is omitted', async () => {
      await service.createSupplierPayment(
        paymentRequest({ purchaseId: undefined, amount: 3000000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.purchase.findFirst).not.toHaveBeenCalled();
      expect(tx.supplierPayment.aggregate).toHaveBeenCalledWith({
        where: {
          shopId: SHOP_ID,
          supplierId: SUPPLIER_ID,
          purchaseId: null,
          status: 'ACTIVE',
        },
        _sum: { amount: true },
      });
      expect(tx.supplierPayment.create.mock.calls[0][0].data.purchaseId).toBe(
        null,
      );
    });

    it('stores blank notes as null on both the payment and the cash row', async () => {
      await service.createSupplierPayment(
        paymentRequest({ notes: '   ' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.supplierPayment.create.mock.calls[0][0].data.notes).toBeNull();
      expect(tx.cashMovement.create.mock.calls[0][0].data.note).toBeNull();

      await service.createSupplierPayment(
        paymentRequest({ notes: 'Paid in cash' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.supplierPayment.create.mock.calls[1][0].data.notes).toBe(
        'Paid in cash',
      );
      expect(tx.cashMovement.create.mock.calls[1][0].data.note).toBe(
        'Paid in cash',
      );
    });
  });

  describe('createSupplierPayment — outstanding rules', () => {
    it('rejects a payment larger than the bill that is left', async () => {
      // Bill is 19000000 and 10000000 has already been paid → 9000000 left.
      tx.supplierPayment.aggregate.mockResolvedValue({
        _sum: { amount: 10000000n },
      });

      await expect(
        service.createSupplierPayment(
          paymentRequest({ amount: 9000001 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('accepts a payment that exactly clears the bill', async () => {
      tx.supplierPayment.aggregate.mockResolvedValue({
        _sum: { amount: 10000000n },
      });

      const res = await service.createSupplierPayment(
        paymentRequest({ amount: 9000000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(expect.objectContaining({ status: true }));
    });

    it('rejects a payment larger than the remaining opening balance', async () => {
      // Opening balance 5000000 with nothing paid against it.
      await expect(
        service.createSupplierPayment(
          paymentRequest({ purchaseId: undefined, amount: 5000001 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
    });

    it('404s on a purchase that belongs to another shop', async () => {
      tx.purchase.findFirst.mockResolvedValue(null);

      await expect(
        service.createSupplierPayment(paymentRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
    });

    it('400s when the bill was made from a different supplier', async () => {
      tx.purchase.findFirst.mockResolvedValue({
        id: PURCHASE_ID,
        purchaseNo: 'P-0003',
        supplierId: '01924f0a-0000-7000-8000-0000000000a9',
        totalAmount: 19000000n,
        status: 'ACTIVE',
        isOpeningStock: false,
      });

      await expect(
        service.createSupplierPayment(paymentRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
    });

    it('400s when the bill is cancelled', async () => {
      tx.purchase.findFirst.mockResolvedValue({
        id: PURCHASE_ID,
        purchaseNo: 'P-0003',
        supplierId: SUPPLIER_ID,
        totalAmount: 19000000n,
        status: 'CANCELLED',
        isOpeningStock: false,
      });

      await expect(
        service.createSupplierPayment(paymentRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('400s when the bill is an opening-stock entry (it has no payable)', async () => {
      tx.purchase.findFirst.mockResolvedValue({
        id: PURCHASE_ID,
        purchaseNo: 'P-0003',
        supplierId: SUPPLIER_ID,
        totalAmount: 19000000n,
        status: 'ACTIVE',
        isOpeningStock: true,
      });

      await expect(
        service.createSupplierPayment(paymentRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('createSupplierPayment — overdraft prompt', () => {
    function lowCash() {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 500000n : 0n },
        }),
      );
    }

    it('returns a confirm prompt and writes nothing when cash would go below zero', async () => {
      lowCash();

      const res = await service.createSupplierPayment(
        paymentRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(
        expect.objectContaining({ confirmOverdraft: true, shortfall: 8500000 }),
      );
      expect(tx.supplierPayment.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('saves with isOverdraft true once confirmOverdraft is sent', async () => {
      lowCash();

      const res = await service.createSupplierPayment(
        paymentRequest({ confirmOverdraft: true }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Supplier payment recorded successfully',
      });
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        true,
      );
    });

    it('does not prompt when the drawer can cover the payment', async () => {
      const res = await service.createSupplierPayment(
        paymentRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(expect.objectContaining({ status: true }));
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        false,
      );
    });
  });

  describe('createSupplierPayment — tenant isolation', () => {
    it('404s on a supplier that belongs to another shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.createSupplierPayment(paymentRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID, shopId: SHOP_ID },
        select: { id: true, name: true },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('sends the shopId from the JWT into both locks', async () => {
      await service.createSupplierPayment(paymentRequest(), 'shop-7', USER_ID);

      // Shop-row lock: one interpolated value = the JWT shopId.
      expect(tx.$queryRaw.mock.calls[0][1]).toBe('shop-7');
      // Supplier-row lock: supplier follows the interpolated shopId.
      expect(tx.$queryRaw.mock.calls[1][2]).toBe('shop-7');
      expect(tx.supplierPayment.create.mock.calls[0][0].data.shopId).toBe(
        'shop-7',
      );
    });
  });

  describe('getSupplierPayments', () => {
    it('scopes the list to the shop from the JWT', async () => {
      prismaStub.supplierPayment.findMany.mockResolvedValue([]);
      prismaStub.supplierPayment.count.mockResolvedValue(0);

      await service.getSupplierPayments({ page: 1, pageSize: 10 }, SHOP_ID);

      const where = prismaStub.supplierPayment.findMany.mock.calls[0][0].where;
      expect(where.shopId).toBe(SHOP_ID);
      expect(prismaStub.supplierPayment.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID },
      });
    });

    it('ANDs the paymentDate range instead of overwriting the search', async () => {
      prismaStub.supplierPayment.findMany.mockResolvedValue([]);
      prismaStub.supplierPayment.count.mockResolvedValue(0);

      await service.getSupplierPayments(
        {
          page: 1,
          pageSize: 10,
          supplierId: SUPPLIER_ID,
          from: '2026-10-01',
          to: '2026-10-31',
          search: 'ABC',
        },
        SHOP_ID,
      );

      const where = prismaStub.supplierPayment.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.OR).toHaveLength(2);
      expect(where.supplierId).toBe(SUPPLIER_ID);
    });
  });

  describe('getSupplierPayable', () => {
    it('derives payable from the opening balance, active purchases and active payments', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue({
        id: SUPPLIER_ID,
        name: 'ABC Mobiles',
        openingBalance: 5000000n,
      });
      prismaStub.purchase.findMany.mockResolvedValue([
        {
          id: PURCHASE_ID,
          purchaseNo: 'P-0003',
          supplierInvoiceRef: 'AB-771',
          purchaseDate: new Date('2026-10-06T00:00:00.000Z'),
          totalAmount: 19000000n,
          supplierPayments: [{ amount: 10000000n }],
        },
      ]);
      prismaStub.supplierPayment.findMany.mockResolvedValue([
        { purchaseId: PURCHASE_ID, amount: 10000000n },
        { purchaseId: null, amount: 5000000n },
      ]);

      const res = await service.getSupplierPayable(SUPPLIER_ID, SHOP_ID);

      expect(res.payable).toBe(9000000); // 5000000 + 19000000 − 15000000
      expect(res.totalPurchases).toBe(19000000);
      expect(res.totalPaid).toBe(15000000);
      expect(res.openingRemaining).toBe(0);
      expect(res.unpaidPurchases).toEqual([
        expect.objectContaining({
          purchaseNo: 'P-0003',
          totalAmount: 19000000,
          paidAmount: 10000000,
          remaining: 9000000,
          purchaseDate: '2026-10-06',
        }),
      ]);
    });

    it('leaves out bills that are already fully paid', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue({
        id: SUPPLIER_ID,
        name: 'ABC Mobiles',
        openingBalance: 0n,
      });
      prismaStub.purchase.findMany.mockResolvedValue([
        {
          id: PURCHASE_ID,
          purchaseNo: 'P-0001',
          supplierInvoiceRef: null,
          purchaseDate: new Date('2026-10-01T00:00:00.000Z'),
          totalAmount: 9000000n,
          supplierPayments: [{ amount: 9000000n }],
        },
      ]);
      prismaStub.supplierPayment.findMany.mockResolvedValue([
        { purchaseId: PURCHASE_ID, amount: 9000000n },
      ]);

      const res = await service.getSupplierPayable(SUPPLIER_ID, SHOP_ID);

      expect(res.unpaidPurchases).toEqual([]);
      expect(res.payable).toBe(0);
    });

    it('404s on a supplier that belongs to another shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.getSupplierPayable(SUPPLIER_ID, SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID, shopId: SHOP_ID },
        select: { id: true, name: true, openingBalance: true },
      });
    });
  });

  describe('cancelSupplierPayment — WF12', () => {
    const activePayment = {
      id: PAYMENT_ID,
      status: 'ACTIVE',
      purchaseId: PURCHASE_ID,
    };
    const cancelDto = { cancelReason: 'Paid the wrong supplier' };

    beforeEach(() => {
      prismaStub.supplierPayment.findFirst.mockResolvedValue(activePayment);
      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM supplier_payments'))
          return [{ status: 'ACTIVE', amount: 900000n }];
        return [];
      });
    });

    it('marks the payment CANCELLED with reason, time and user', async () => {
      const res = await service.cancelSupplierPayment(
        PAYMENT_ID,
        cancelDto,
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Supplier payment cancelled successfully',
      });
      expect(tx.supplierPayment.update).toHaveBeenCalledWith({
        where: { id: PAYMENT_ID, shopId: SHOP_ID },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Paid the wrong supplier',
          cancelledById: USER_ID,
          cancelledAt: expect.any(Date),
        }),
      });
    });

    it('inserts a REVERSAL IN pointing back at the original cash movement', async () => {
      await service.cancelSupplierPayment(
        PAYMENT_ID,
        cancelDto,
        SHOP_ID,
        USER_ID,
      );

      expect(tx.cashMovement.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          shopId: SHOP_ID,
          type: 'SUPPLIER_PAYMENT',
          referenceType: 'SUPPLIER_PAYMENT',
          referenceId: PAYMENT_ID,
        }),
        select: { id: true },
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'REVERSAL',
          direction: 'IN',
          amount: 900000n,
          referenceType: 'SUPPLIER_PAYMENT',
          referenceId: PAYMENT_ID,
          reversesMovementId: 'cm-original-1',
          note: 'Paid the wrong supplier',
        }),
      });
    });

    it("falls back to the purchase's own cash row for WF6's paidNow payment", async () => {
      tx.cashMovement.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'cm-purchase' });

      await service.cancelSupplierPayment(
        PAYMENT_ID,
        cancelDto,
        SHOP_ID,
        USER_ID,
      );

      expect(
        tx.cashMovement.create.mock.calls[0][0].data.reversesMovementId,
      ).toBe('cm-purchase');
    });

    it('404s when the payment belongs to another shop', async () => {
      prismaStub.supplierPayment.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelSupplierPayment(PAYMENT_ID, cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the payment is already cancelled', async () => {
      prismaStub.supplierPayment.findFirst.mockResolvedValue({
        ...activePayment,
        status: 'CANCELLED',
      });

      await expect(
        service.cancelSupplierPayment(PAYMENT_ID, cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the original cash movement is missing, writing nothing', async () => {
      tx.cashMovement.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelSupplierPayment(PAYMENT_ID, cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
      expect(tx.supplierPayment.update).not.toHaveBeenCalled();
    });
  });

  describe('getCancelImpact', () => {
    beforeEach(() => {
      prismaStub.supplierPayment.findFirst.mockResolvedValue({
        id: PAYMENT_ID,
        status: 'ACTIVE',
        amount: 250000n,
        supplierId: SUPPLIER_ID,
      });
      prismaStub.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 500000n : 0n },
        }),
      );
      prismaStub.supplier.findFirst.mockResolvedValue({
        openingBalance: 0n,
      });
      prismaStub.purchase.aggregate.mockResolvedValue({
        _sum: { totalAmount: 1000000n },
      });
      prismaStub.supplierPayment.aggregate.mockResolvedValue({
        _sum: { amount: 400000n },
      });
    });

    it('shows cash in and the payable after, writing nothing', async () => {
      const res = await service.getCancelImpact(PAYMENT_ID, SHOP_ID);

      expect(res).toMatchObject({
        recordType: 'SUPPLIER_PAYMENT',
        recordId: PAYMENT_ID,
        recordNo: null,
        currentCash: 500000,
        cashReversedAmount: 250000,
        cashReversedDirection: 'IN',
        cashAfter: 750000,
        willCauseOverdraft: false,
        // payable 0 + 1000000 − 400000 = 600000, plus this 250000
        // payment given back = 850000.
        supplierPayableAfter: 850000,
        customerUdharAfter: null,
        stockItems: [],
        blocked: false,
        blockedReason: null,
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the supplier payment is already cancelled', async () => {
      prismaStub.supplierPayment.findFirst.mockResolvedValue({
        id: PAYMENT_ID,
        status: 'CANCELLED',
        amount: 250000n,
        supplierId: SUPPLIER_ID,
      });

      await expect(
        service.getCancelImpact(PAYMENT_ID, SHOP_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the supplier payment belongs to another shop', async () => {
      prismaStub.supplierPayment.findFirst.mockResolvedValue(null);

      await expect(
        service.getCancelImpact(PAYMENT_ID, SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';
const CUSTOMER_ID = '01924f0a-0000-7000-8000-0000000000a7';
const SALE_OLD_ID = '01924f0a-0000-7000-8000-0000000001c1';
const SALE_NEW_ID = '01924f0a-0000-7000-8000-0000000001c2';
const CLIENT_REQUEST_ID = '01924f0a-0000-7000-8000-00000000beef';

const prismaStub = {
  payment: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  customer: { findFirst: jest.fn() },
  sale: { findMany: jest.fn(), aggregate: jest.fn() },
  cashMovement: { aggregate: jest.fn() },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  payment: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  sale: { findMany: jest.Mock };
  saleReturn: { groupBy: jest.Mock };
  refund: { findMany: jest.Mock };
  cashMovement: {
    create: jest.Mock;
    findFirst: jest.Mock;
    aggregate: jest.Mock;
  };
}

/** Mutable per-test data the $queryRaw dispatcher reads at call time. */
let txConfig: {
  openingBalance: bigint;
  openSales: Array<{ id: string; total_amount: bigint }>;
  paidRows: Array<{ sale_id: string | null; total: bigint }>;
};

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  let paymentSeq = 0;
  const tx: TxStub = {
    $queryRaw: jest.fn().mockImplementation((strings: string[]) => {
      const sql = strings.join('');
      if (sql.includes('FROM shops')) {
        return Promise.resolve([{ id: SHOP_ID }]);
      }
      if (sql.includes('FROM customers')) {
        return Promise.resolve([
          { name: 'Ali Khan', opening_balance: txConfig.openingBalance },
        ]);
      }
      if (sql.includes('FROM payments')) {
        return Promise.resolve(txConfig.paidRows);
      }
      if (sql.includes('ORDER BY sale_date')) {
        return Promise.resolve(txConfig.openSales);
      }
      if (sql.includes('FROM sales')) {
        // Per-row lock in explicit mode — only the length is checked.
        return Promise.resolve([{ id: SALE_NEW_ID }]);
      }
      return Promise.resolve([]);
    }),
    payment: {
      create: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ id: `payment-${++paymentSeq}` }),
        ),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    sale: { findMany: jest.fn() },
    // No returns or refunds by default — individual tests opt in.
    saleReturn: { groupBy: jest.fn().mockResolvedValue([]) },
    refund: { findMany: jest.fn().mockResolvedValue([]) },
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

/** The PDF's example: Ali owes 5,000,000 on the older sale, 800,000 on the newer. */
function paymentRequest(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: CLIENT_REQUEST_ID,
    customerId: CUSTOMER_ID,
    amount: 5500000,
    paymentDate: '2026-10-07',
    ...overrides,
  } as any;
}

function adapterViolation(indexName: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: {
      modelName: 'Payment',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23505',
          kind: 'UniqueConstraintViolation',
          constraint: { index: indexName },
          table: 'payments',
        },
      },
    },
  });
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);

    txConfig = {
      openingBalance: 0n,
      openSales: [
        { id: SALE_OLD_ID, total_amount: 5000000n },
        { id: SALE_NEW_ID, total_amount: 800000n },
      ],
      paidRows: [],
    };

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.payment.findFirst.mockResolvedValue(null);
    prismaStub.customer.findFirst.mockResolvedValue({ id: CUSTOMER_ID });
    prismaStub.sale.findMany.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPayment — oldest-first allocation', () => {
    it('applies the amount to the oldest unpaid sale first (the PDF example)', async () => {
      const res = await service.createPayment(
        paymentRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Payment recorded successfully',
      });
      expect(tx.payment.create).toHaveBeenCalledTimes(2);

      const first = tx.payment.create.mock.calls[0][0].data;
      const second = tx.payment.create.mock.calls[1][0].data;
      expect(first.saleId).toBe(SALE_OLD_ID);
      expect(first.amount).toBe(5000000n);
      expect(second.saleId).toBe(SALE_NEW_ID);
      expect(second.amount).toBe(500000n);
      expect(first.receiptGroupId).toBe(second.receiptGroupId);
      expect(first.clientRequestId).toBe(CLIENT_REQUEST_ID);
      expect(second.clientRequestId).toBe(CLIENT_REQUEST_ID);
      expect(tx.cashMovement.create).toHaveBeenCalledTimes(2);
    });

    it('pays the opening balance first, then the oldest sale', async () => {
      txConfig.openingBalance = 100000n;

      await service.createPayment(
        paymentRequest({ amount: 300000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.payment.create).toHaveBeenCalledTimes(2);
      const opening = tx.payment.create.mock.calls[0][0].data;
      const againstSale = tx.payment.create.mock.calls[1][0].data;
      expect(opening.saleId).toBeNull();
      expect(opening.amount).toBe(100000n);
      expect(againstSale.saleId).toBe(SALE_OLD_ID);
      expect(againstSale.amount).toBe(200000n);
    });

    it('skips a sale that is already fully paid', async () => {
      txConfig.paidRows = [{ sale_id: SALE_OLD_ID, total: 5000000n }];

      await service.createPayment(
        paymentRequest({ amount: 800000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.payment.create).toHaveBeenCalledTimes(1);
      expect(tx.payment.create.mock.calls[0][0].data.saleId).toBe(SALE_NEW_ID);
      expect(tx.payment.create.mock.calls[0][0].data.amount).toBe(800000n);
    });

    it('rejects paying more than the customer owes, writing nothing', async () => {
      await expect(
        service.createPayment(
          paymentRequest({ amount: 5800001 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('derives the outstanding from earlier payments, not from the sale total', async () => {
      txConfig.paidRows = [{ sale_id: SALE_OLD_ID, total: 200000n }];
      txConfig.openSales = [
        { id: SALE_OLD_ID, total_amount: 5000000n },
        { id: SALE_NEW_ID, total_amount: 800000n },
      ];

      // Remaining = (5,000,000 − 200,000) + 800,000 = 5,600,000.
      await expect(
        service.createPayment(
          paymentRequest({ amount: 5600001 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.payment.create).not.toHaveBeenCalled();

      await service.createPayment(
        paymentRequest({ amount: 5600000 }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.payment.create).toHaveBeenCalledTimes(2);
      expect(tx.payment.create.mock.calls[0][0].data.amount).toBe(4800000n);
      expect(tx.payment.create.mock.calls[1][0].data.amount).toBe(800000n);
    });

    it('subtracts returns and adds refunds from a sale’s outstanding (WF15)', async () => {
      tx.saleReturn.groupBy.mockResolvedValue([
        { saleId: SALE_OLD_ID, _sum: { returnAmount: 1500000n } },
      ]);

      // (5,000,000 − 1,500,000) + 800,000 = 4,300,000 — one paisa more is 400.
      await expect(
        service.createPayment(
          paymentRequest({ amount: 4300001 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.saleReturn.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            saleId: { in: [SALE_OLD_ID, SALE_NEW_ID] },
            status: 'ACTIVE',
          },
        }),
      );

      await service.createPayment(
        paymentRequest({ amount: 4300000 }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.payment.create).toHaveBeenCalledTimes(2);
      expect(tx.payment.create.mock.calls[0][0].data.amount).toBe(3500000n);
      expect(tx.payment.create.mock.calls[1][0].data.amount).toBe(800000n);

      // A refund puts cash back into the bill: 5,000,000 − 1,500,000
      // − 4,300,000 paid + 500,000 refunded = −300,000 → clamped to 0,
      // while the second sale still owes 800,000 (paidRows reset below).
      tx.saleReturn.groupBy.mockClear();
      txConfig.paidRows = [{ sale_id: SALE_OLD_ID, total: 4300000n }];
      tx.refund.findMany.mockResolvedValue([
        { amount: 500000n, saleReturn: { saleId: SALE_OLD_ID } },
      ]);
      await expect(
        service.createPayment(
          paymentRequest({ amount: 800001 }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await service.createPayment(
        paymentRequest({ amount: 800000 }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.payment.create.mock.calls[2][0].data.amount).toBe(800000n);
      expect(tx.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            saleReturn: {
              saleId: { in: [SALE_OLD_ID, SALE_NEW_ID] },
              status: 'ACTIVE',
            },
          },
        }),
      );
    });

    it('uses paymentDate as the cash movementDate and stores blank notes as null', async () => {
      await service.createPayment(
        paymentRequest({ notes: '   ' }),
        SHOP_ID,
        USER_ID,
      );

      const payment = tx.payment.create.mock.calls[0][0].data;
      expect(payment.paymentDate).toEqual(new Date('2026-10-07'));
      expect(payment.notes).toBeNull();

      const cash = tx.cashMovement.create.mock.calls[0][0].data;
      expect(cash.movementDate).toEqual(new Date('2026-10-07'));
      expect(cash.type).toBe('CUSTOMER_PAYMENT');
      expect(cash.direction).toBe('IN');
      expect(cash.referenceType).toBe('PAYMENT');
      expect(cash.referenceId).toBe('payment-1');
    });
  });

  describe('createPayment — explicit salesIds', () => {
    function primeExplicitSales() {
      const ordered = [
        { id: SALE_OLD_ID, totalAmount: 5000000n },
        { id: SALE_NEW_ID, totalAmount: 800000n },
      ];
      prismaStub.sale.findMany.mockImplementation((args: any) =>
        Promise.resolve(args.where.id.in.map((id: string) => ({ id }))),
      );
      tx.sale.findMany.mockImplementation((args: any) =>
        Promise.resolve(
          ordered.filter((sale) => args.where.id.in.includes(sale.id)),
        ),
      );
    }

    it('pays only the named sales and never the opening balance', async () => {
      primeExplicitSales();
      txConfig.openingBalance = 100000n;

      await service.createPayment(
        paymentRequest({ amount: 800000, salesIds: [SALE_NEW_ID] }),
        SHOP_ID,
        USER_ID,
      );

      expect(prismaStub.sale.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [SALE_NEW_ID] },
          shopId: SHOP_ID,
          customerId: CUSTOMER_ID,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      expect(tx.payment.create).toHaveBeenCalledTimes(1);
      expect(tx.payment.create.mock.calls[0][0].data.saleId).toBe(SALE_NEW_ID);
      expect(tx.payment.create.mock.calls[0][0].data.amount).toBe(800000n);
    });

    it('rejects an amount larger than the named sales still owe', async () => {
      primeExplicitSales();

      await expect(
        service.createPayment(
          paymentRequest({ amount: 5800001, salesIds: [SALE_OLD_ID] }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('404s when a named sale is not an ACTIVE sale of this customer', async () => {
      prismaStub.sale.findMany.mockResolvedValue([{ id: SALE_NEW_ID }]);

      await expect(
        service.createPayment(
          paymentRequest({ salesIds: [SALE_OLD_ID, SALE_NEW_ID] }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('rejects the same sale listed twice in one request', async () => {
      await expect(
        service.createPayment(
          paymentRequest({ salesIds: [SALE_NEW_ID, SALE_NEW_ID] }),
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.sale.findMany).not.toHaveBeenCalled();
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createPayment — tenant checks', () => {
    it('404s on a customer that belongs to another shop', async () => {
      prismaStub.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.createPayment(paymentRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.customer.findFirst).toHaveBeenCalledWith({
        where: { id: CUSTOMER_ID, shopId: SHOP_ID },
        select: { id: true },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createPayment — idempotency', () => {
    it('answers "already saved" without opening a transaction when the clientRequestId exists', async () => {
      prismaStub.payment.findFirst.mockResolvedValue({ id: 'payment-1' });

      const res = await service.createPayment(
        paymentRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Payment already saved',
      });
      expect(prismaStub.payment.findFirst).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID, clientRequestId: CLIENT_REQUEST_ID },
        select: { id: true },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('checks the replay AGAIN under the lock and writes nothing when it hits', async () => {
      tx.payment.findFirst.mockResolvedValue({ id: 'payment-1' });

      const res = await service.createPayment(
        paymentRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Payment already saved',
      });
      expect(tx.payment.findFirst).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID, clientRequestId: CLIENT_REQUEST_ID },
        select: { id: true },
      });
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('maps a racing P2002 on the idempotency index to the replay message', async () => {
      prismaStub.$transaction.mockRejectedValue(
        adapterViolation('payments_idempotency_uq'),
      );

      const res = await service.createPayment(
        paymentRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Payment already saved',
      });
    });

    it('rethrows a P2002 from any other index instead of swallowing it', async () => {
      prismaStub.$transaction.mockRejectedValue(
        adapterViolation('payments_shop_id_customer_id_idx'),
      );

      await expect(
        service.createPayment(paymentRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });

  describe('createPayment — lock order', () => {
    it('locks shop → customer → sales, oldest first, then reads payments', async () => {
      await service.createPayment(paymentRequest(), SHOP_ID, USER_ID);

      const sqls = tx.$queryRaw.mock.calls.map((c) =>
        (c[0] as string[]).join(''),
      );
      expect(sqls[0]).toContain('FROM shops');
      expect(sqls[0]).toContain('FOR UPDATE');
      expect(sqls[1]).toContain('FROM customers');
      expect(sqls[1]).toContain('FOR UPDATE');
      expect(sqls[2]).toContain('FROM sales');
      expect(sqls[2]).toContain('FOR UPDATE');
      expect(sqls[2]).toContain('ORDER BY sale_date');
      expect(sqls[3]).toContain('FROM payments');
      expect(sqls[3]).toContain("status = 'ACTIVE'");
      expect(sqls[3]).toContain('GROUP BY sale_id');
    });

    it('locks explicit sales one by one in (saleDate, id) order', async () => {
      const ordered = [
        { id: SALE_OLD_ID, totalAmount: 5000000n },
        { id: SALE_NEW_ID, totalAmount: 800000n },
      ];
      prismaStub.sale.findMany.mockResolvedValue(
        ordered.map((s) => ({ id: s.id })),
      );
      tx.sale.findMany.mockResolvedValue(ordered);

      await service.createPayment(
        paymentRequest({ amount: 1000, salesIds: [SALE_NEW_ID, SALE_OLD_ID] }),
        SHOP_ID,
        USER_ID,
      );

      expect(tx.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ saleDate: 'asc' }, { id: 'asc' }],
        }),
      );
      const lockSqls = tx.$queryRaw.mock.calls
        .map((c) => (c[0] as string[]).join(''))
        .filter((sql) => sql.includes('FROM sales'));
      expect(lockSqls).toHaveLength(2);
      expect(lockSqls[0]).toContain('FOR UPDATE');
      expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FROM shops');
    });
  });

  describe('getPayments', () => {
    it('scopes the list to the shop from the JWT', async () => {
      prismaStub.payment.findMany.mockResolvedValue([]);
      prismaStub.payment.count.mockResolvedValue(0);

      await service.getPayments({ page: 1, pageSize: 10 }, SHOP_ID);

      const where = prismaStub.payment.findMany.mock.calls[0][0].where;
      expect(where.shopId).toBe(SHOP_ID);
      expect(prismaStub.payment.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID },
      });
    });

    it('filters by customer, sale, receipt group and status', async () => {
      prismaStub.payment.findMany.mockResolvedValue([]);
      prismaStub.payment.count.mockResolvedValue(0);

      await service.getPayments(
        {
          page: 1,
          pageSize: 10,
          customerId: CUSTOMER_ID,
          saleId: SALE_OLD_ID,
          receiptGroupId: CLIENT_REQUEST_ID,
          status: 'ACTIVE',
        } as any,
        SHOP_ID,
      );

      expect(prismaStub.payment.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          shopId: SHOP_ID,
          customerId: CUSTOMER_ID,
          saleId: SALE_OLD_ID,
          receiptGroupId: CLIENT_REQUEST_ID,
          status: 'ACTIVE',
        }),
      );
    });

    it('ANDs the paymentDate range instead of overwriting the search OR', async () => {
      prismaStub.payment.findMany.mockResolvedValue([]);
      prismaStub.payment.count.mockResolvedValue(0);

      await service.getPayments(
        {
          page: 1,
          pageSize: 10,
          from: '2026-10-01',
          to: '2026-10-31',
          search: 'ali',
        },
        SHOP_ID,
      );

      const where = prismaStub.payment.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.OR).toHaveLength(2);
      expect(where.shopId).toBe(SHOP_ID);
    });
  });

  describe('getPaymentById', () => {
    it('404s when the payment belongs to another shop', async () => {
      prismaStub.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.getPaymentById('payment-1', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.payment.findFirst).toHaveBeenCalledWith({
        where: { id: 'payment-1', shopId: SHOP_ID },
        include: expect.anything(),
      });
    });

    it('maps BigInt money to plain numbers and resolves customer and sale', async () => {
      prismaStub.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        shopId: SHOP_ID,
        customerId: CUSTOMER_ID,
        customer: { name: 'Ali Khan' },
        saleId: SALE_OLD_ID,
        sale: { saleNo: 'S-0002' },
        receiptGroupId: '01924f0a-0000-7000-8000-0000000009e2',
        amount: 5000000n,
        paymentDate: new Date('2026-10-07T00:00:00.000Z'),
        method: 'CASH',
        status: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        cancelledById: null,
        clientRequestId: CLIENT_REQUEST_ID,
        notes: null,
        createdById: USER_ID,
        createdAt: new Date('2026-10-07T09:20:00.000Z'),
        updatedAt: new Date('2026-10-07T09:20:00.000Z'),
      });

      const res = await service.getPaymentById('payment-1', SHOP_ID);

      expect(res.amount).toBe(5000000);
      expect(res.customerName).toBe('Ali Khan');
      expect(res.saleNo).toBe('S-0002');
      expect(res.receiptGroupId).toBe('01924f0a-0000-7000-8000-0000000009e2');
      expect(res.method).toBe('CASH');
    });
  });

  describe('cancelPayment — WF12', () => {
    const activePayment = {
      id: 'payment-1',
      status: 'ACTIVE',
      amount: 5000000n,
    };
    const cancelDto = { cancelReason: 'Paid the wrong bill' };

    beforeEach(() => {
      prismaStub.payment.findFirst.mockResolvedValue(activePayment);
      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM payments'))
          return [{ status: 'ACTIVE', amount: 5000000n }];
        return [];
      });
    });

    it('marks the payment CANCELLED with reason, time and user', async () => {
      const res = await service.cancelPayment(
        'payment-1',
        cancelDto,
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Payment cancelled successfully',
      });
      expect(tx.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1', shopId: SHOP_ID },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Paid the wrong bill',
          cancelledById: USER_ID,
          cancelledAt: expect.any(Date),
        }),
      });
    });

    it('locks the payment row FOR UPDATE and re-checks it is ACTIVE', async () => {
      await service.cancelPayment('payment-1', cancelDto, SHOP_ID, USER_ID);

      const lock = tx.$queryRaw.mock.calls.find((call: any) =>
        call[0].join('').includes('FROM payments'),
      );
      expect(lock[0].join('')).toContain('FOR UPDATE');

      tx.$queryRaw.mockImplementation((strings: any) => {
        const sql = strings?.join('') ?? '';
        if (sql.includes('FROM shops')) return [{ id: SHOP_ID }];
        if (sql.includes('FROM payments')) return [{ status: 'CANCELLED' }];
        return [];
      });
      tx.payment.update.mockClear();

      await expect(
        service.cancelPayment('payment-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.payment.update).not.toHaveBeenCalled();
    });

    it('inserts a REVERSAL OUT pointing back at the original cash movement', async () => {
      await service.cancelPayment('payment-1', cancelDto, SHOP_ID, USER_ID);

      expect(tx.cashMovement.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          shopId: SHOP_ID,
          type: 'CUSTOMER_PAYMENT',
          referenceType: 'PAYMENT',
          referenceId: 'payment-1',
        }),
        select: { id: true },
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'REVERSAL',
          direction: 'OUT',
          amount: 5000000n,
          referenceType: 'PAYMENT',
          referenceId: 'payment-1',
          reversesMovementId: 'cm-original-1',
          note: 'Paid the wrong bill',
        }),
      });
    });

    it('returns a confirm prompt and writes nothing when the refund takes cash below zero', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 300000n : 0n },
        }),
      );

      const res = await service.cancelPayment(
        'payment-1',
        cancelDto,
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(
        expect.objectContaining({ confirmOverdraft: true, shortfall: 4700000 }),
      );
      expect(res.message).toContain('payment cancellation');
      expect(tx.payment.update).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('cancels anyway with isOverdraft true once confirmOverdraft is sent', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 300000n : 0n },
        }),
      );

      const res = await service.cancelPayment(
        'payment-1',
        { ...cancelDto, confirmOverdraft: true },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Payment cancelled successfully',
      });
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        true,
      );
    });

    it('404s when the payment belongs to another shop', async () => {
      prismaStub.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelPayment('payment-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the payment is already cancelled', async () => {
      prismaStub.payment.findFirst.mockResolvedValue({
        ...activePayment,
        status: 'CANCELLED',
      });

      await expect(
        service.cancelPayment('payment-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the original cash movement is missing, writing nothing', async () => {
      tx.cashMovement.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelPayment('payment-1', cancelDto, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
      expect(tx.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('getCancelImpact', () => {
    beforeEach(() => {
      prismaStub.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: 'ACTIVE',
        amount: 400000n,
        customerId: CUSTOMER_ID,
      });
      prismaStub.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 900000n : 100000n },
        }),
      );
      prismaStub.customer.findFirst.mockResolvedValue({
        openingBalance: 100000n,
      });
      prismaStub.sale.aggregate.mockResolvedValue({
        _sum: { totalAmount: 700000n },
      });
      prismaStub.payment.aggregate.mockResolvedValue({
        _sum: { amount: 300000n },
      });
    });

    it('shows cash out and the Udhar back, writing nothing', async () => {
      const res = await service.getCancelImpact('payment-1', SHOP_ID);

      expect(res).toMatchObject({
        recordType: 'PAYMENT',
        recordId: 'payment-1',
        recordNo: null,
        currentCash: 800000,
        cashReversedAmount: 400000,
        cashReversedDirection: 'OUT',
        cashAfter: 400000,
        willCauseOverdraft: false,
        // balance 100000 + 700000 − 300000 = 500000, plus this 400000
        // payment given back = 900000.
        customerUdharAfter: 900000,
        supplierPayableAfter: null,
        stockItems: [],
        blocked: false,
        blockedReason: null,
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the payment is already cancelled', async () => {
      prismaStub.payment.findFirst.mockResolvedValue({
        id: 'payment-1',
        status: 'CANCELLED',
        amount: 400000n,
        customerId: CUSTOMER_ID,
      });

      await expect(
        service.getCancelImpact('payment-1', SHOP_ID),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('404s when the payment belongs to another shop', async () => {
      prismaStub.payment.findFirst.mockResolvedValue(null);

      await expect(
        service.getCancelImpact('payment-1', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });
});

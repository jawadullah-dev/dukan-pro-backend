import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpensesService } from './expenses.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';
const CATEGORY_ID = '01924f0a-0000-7000-8000-0000000000c1';
const EXPENSE_ID = '01924f0a-0000-7000-8000-0000000000e1';

const prismaStub = {
  expense: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  expenseCategory: { findFirst: jest.fn() },
  cashMovement: {
    create: jest.fn(),
    aggregate: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  expense: { create: jest.Mock; update: jest.Mock };
  cashMovement: {
    create: jest.Mock;
    aggregate: jest.Mock;
    findFirst: jest.Mock;
  };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  const tx: TxStub = {
    // Two raw locks run in a cancel: the shop row (always { id: SHOP_ID })
    // and the expense row re-check ({ status }) — dispatch on the SQL.
    $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('FROM expenses')) {
        return Promise.resolve([{ status: 'ACTIVE' }]);
      }
      return Promise.resolve([{ id: SHOP_ID }]);
    }),
    expense: {
      create: jest.fn().mockResolvedValue({ id: EXPENSE_ID }),
      update: jest.fn().mockResolvedValue({}),
    },
    cashMovement: {
      create: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      // Plenty of opening cash by default so ordinary expenses never prompt.
      aggregate: jest.fn().mockImplementation((args: any) =>
        Promise.resolve({
          _sum: {
            amount: args.where.direction === 'IN' ? 100000000n : 0n,
          },
        }),
      ),
      findFirst: jest.fn().mockResolvedValue({ id: 'cm-original-1' }),
    },
    ...overrides,
  };
  return tx;
}

function makeExpenseRequest(overrides: Record<string, unknown> = {}) {
  return {
    categoryId: CATEGORY_ID,
    amount: 500000,
    expenseDate: '2026-10-06',
    description: 'October electricity bill',
    confirmOverdraft: false,
    ...overrides,
  } as any;
}

describe('ExpensesService', () => {
  let service: ExpensesService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.expenseCategory.findFirst.mockResolvedValue({ id: CATEGORY_ID });
    prismaStub.expense.findFirst.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createExpense — happy path', () => {
    it('inserts an ACTIVE expense and an OUT cash movement in one transaction', async () => {
      const res = await service.createExpense(
        makeExpenseRequest(),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Expense recorded successfully',
      });
      expect(tx.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          categoryId: CATEGORY_ID,
          amount: 500000n,
          createdById: USER_ID,
        }),
        select: { id: true },
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          type: 'EXPENSE',
          direction: 'OUT',
          amount: 500000n,
          referenceType: 'EXPENSE',
          referenceId: EXPENSE_ID,
          isOverdraft: false,
        }),
      });
    });

    it('stores blank description as null instead of an empty string', async () => {
      await service.createExpense(
        makeExpenseRequest({ description: '   ' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.expense.create.mock.calls[0][0].data.description).toBeNull();

      await service.createExpense(
        makeExpenseRequest({ description: '' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.expense.create.mock.calls[1][0].data.description).toBeNull();

      await service.createExpense(
        makeExpenseRequest({ description: 'October bill' }),
        SHOP_ID,
        USER_ID,
      );
      expect(tx.expense.create.mock.calls[2][0].data.description).toBe(
        'October bill',
      );
    });

    it('locks the shop row before the cash aggregate', async () => {
      await service.createExpense(makeExpenseRequest(), SHOP_ID, USER_ID);

      const lockSql = tx.$queryRaw.mock.calls[0][0] as string[];
      expect(lockSql.join('')).toContain('FOR UPDATE');
      expect(lockSql.join('')).toContain('SELECT id FROM shops');
    });
  });

  describe('createExpense — tenant isolation', () => {
    it('404s when the category belongs to another shop', async () => {
      prismaStub.expenseCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.createExpense(makeExpenseRequest(), SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.expenseCategory.findFirst).toHaveBeenCalledWith({
        where: { id: CATEGORY_ID, shopId: SHOP_ID },
        select: { id: true },
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createExpense — overdraft prompt', () => {
    it('returns a confirm prompt and writes nothing when cash would go below zero', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 300000n : 0n },
        }),
      );

      const res = await service.createExpense(
        makeExpenseRequest({ amount: 500000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual(
        expect.objectContaining({ confirmOverdraft: true, shortfall: 200000 }),
      );
      expect(res.message).toContain('This expense');
      expect(tx.expense.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('saves with isOverdraft true once confirmOverdraft is sent', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 300000n : 0n },
        }),
      );

      const res = await service.createExpense(
        makeExpenseRequest({ amount: 500000, confirmOverdraft: true }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Expense recorded successfully',
      });
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        true,
      );
    });

    it('does not prompt when the expense fits in the drawer', async () => {
      tx.cashMovement.aggregate.mockImplementation((args: any) =>
        Promise.resolve({
          _sum: { amount: args.where.direction === 'IN' ? 50000000n : 0n },
        }),
      );

      const res = await service.createExpense(
        makeExpenseRequest({ amount: 500000 }),
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Expense recorded successfully',
      });
      expect(tx.cashMovement.create.mock.calls[0][0].data.isOverdraft).toBe(
        false,
      );
    });
  });

  describe('cancelExpense', () => {
    const activeExpense = {
      id: EXPENSE_ID,
      status: 'ACTIVE',
      amount: 500000n,
    };

    beforeEach(() => {
      prismaStub.expense.findFirst.mockResolvedValue(activeExpense);
    });

    it('sets status to CANCELLED with reason, time and user', async () => {
      const res = await service.cancelExpense(
        EXPENSE_ID,
        { cancelReason: 'Entered twice by mistake' },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Expense cancelled successfully',
      });
      expect(tx.expense.update).toHaveBeenCalledWith({
        where: { id: EXPENSE_ID, shopId: SHOP_ID },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelReason: 'Entered twice by mistake',
          cancelledById: USER_ID,
          cancelledAt: expect.any(Date),
        }),
      });
    });

    it('inserts a REVERSAL cash movement pointing back to the original', async () => {
      await service.cancelExpense(
        EXPENSE_ID,
        { cancelReason: 'Entered twice by mistake' },
        SHOP_ID,
        USER_ID,
      );

      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          type: 'REVERSAL',
          direction: 'IN',
          amount: 500000n,
          referenceType: 'EXPENSE',
          referenceId: EXPENSE_ID,
          reversesMovementId: 'cm-original-1',
          note: 'Entered twice by mistake',
        }),
      });
    });

    it('404s when the expense belongs to another shop', async () => {
      prismaStub.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelExpense(
          EXPENSE_ID,
          { cancelReason: 'mistake' },
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s when the expense is already cancelled', async () => {
      prismaStub.expense.findFirst.mockResolvedValue({
        ...activeExpense,
        status: 'CANCELLED',
      });

      await expect(
        service.cancelExpense(
          EXPENSE_ID,
          { cancelReason: 'mistake' },
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
    });

    it('400s under the row lock when a racing cancel won first, writing nothing', async () => {
      // The pre-check still saw ACTIVE (the loser's snapshot), but the
      // FOR UPDATE re-read inside the tx returns CANCELLED — the winner
      // committed between the two reads.
      tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = strings.join('');
        if (sql.includes('FROM expenses')) {
          return Promise.resolve([{ status: 'CANCELLED' }]);
        }
        return Promise.resolve([{ id: SHOP_ID }]);
      });

      await expect(
        service.cancelExpense(
          EXPENSE_ID,
          { cancelReason: 'mistake' },
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.expense.update).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('404s when the original cash movement is missing, writing nothing', async () => {
      tx.cashMovement.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelExpense(
          EXPENSE_ID,
          { cancelReason: 'mistake' },
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('locks the shop row inside the cancel transaction', async () => {
      await service.cancelExpense(
        EXPENSE_ID,
        { cancelReason: 'mistake' },
        SHOP_ID,
        USER_ID,
      );

      const lockSql = tx.$queryRaw.mock.calls[0][0] as string[];
      expect(lockSql.join('')).toContain('FOR UPDATE');
    });
  });

  describe('getExpenses', () => {
    it('scopes the list to the shop from the JWT', async () => {
      prismaStub.expense.findMany.mockResolvedValue([]);
      prismaStub.expense.count.mockResolvedValue(0);

      await service.getExpenses({ page: 1, pageSize: 10 }, SHOP_ID);

      const where = prismaStub.expense.findMany.mock.calls[0][0].where;
      expect(where.shopId).toBe(SHOP_ID);
      expect(prismaStub.expense.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID },
      });
    });

    it('filters by categoryId and status', async () => {
      prismaStub.expense.findMany.mockResolvedValue([]);
      prismaStub.expense.count.mockResolvedValue(0);

      await service.getExpenses(
        {
          page: 1,
          pageSize: 10,
          categoryId: CATEGORY_ID,
          status: 'ACTIVE',
        } as any,
        SHOP_ID,
      );

      expect(prismaStub.expense.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({
          shopId: SHOP_ID,
          categoryId: CATEGORY_ID,
          status: 'ACTIVE',
        }),
      );
    });

    it('ANDs the expenseDate range so it cannot clobber the search', async () => {
      prismaStub.expense.findMany.mockResolvedValue([]);
      prismaStub.expense.count.mockResolvedValue(0);

      await service.getExpenses(
        { page: 1, pageSize: 10, from: '2026-10-01', to: '2026-10-31' },
        SHOP_ID,
      );

      const where = prismaStub.expense.findMany.mock.calls[0][0].where;
      expect(where.AND).toHaveLength(2);
      expect(where.shopId).toBe(SHOP_ID);
    });
  });

  describe('getExpenseById', () => {
    it('404s when the expense belongs to another shop', async () => {
      prismaStub.expense.findFirst.mockResolvedValue(null);

      await expect(
        service.getExpenseById(EXPENSE_ID, SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.expense.findFirst).toHaveBeenCalledWith({
        where: { id: EXPENSE_ID, shopId: SHOP_ID },
        include: expect.anything(),
      });
    });

    it('maps BigInt amount to a plain number and formats the business date', async () => {
      prismaStub.expense.findFirst.mockResolvedValue({
        id: EXPENSE_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        category: { name: 'Electricity' },
        amount: 500000n,
        expenseDate: new Date('2026-10-06T00:00:00.000Z'),
        description: 'October electricity bill',
        status: 'ACTIVE',
        cancelledAt: null,
        cancelReason: null,
        cancelledById: null,
        createdById: USER_ID,
        createdAt: new Date('2026-10-06T09:20:00.000Z'),
        updatedAt: new Date('2026-10-06T09:20:00.000Z'),
      });

      const res = await service.getExpenseById(EXPENSE_ID, SHOP_ID);

      expect(res.amount).toBe(500000);
      expect(res.expenseDate).toBe('2026-10-06');
      expect(res.categoryName).toBe('Electricity');
    });
  });
});

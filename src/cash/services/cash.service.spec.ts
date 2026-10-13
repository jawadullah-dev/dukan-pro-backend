import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CashService } from './cash.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { businessDayRange, businessToday } from '../../helpers/date.helper.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';

const prismaStub = {
  cashMovement: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  cashMovement: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    aggregate: jest.Mock;
  };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: SHOP_ID }]),
    cashMovement: {
      create: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(({ where }: { where: { direction?: string } }) =>
        Promise.resolve({
          _sum: {
            amount: where.direction === 'IN' ? 100000000n : 0n,
          },
        }),
      ),
    },
    ...overrides,
  };
}

const movementRow = {
  id: 'cm-1',
  shopId: SHOP_ID,
  type: 'EXPENSE',
  direction: 'OUT',
  amount: 500000n,
  movementDate: new Date('2026-10-06T00:00:00.000Z'),
  referenceType: 'EXPENSE',
  referenceId: '01924f0a-0000-7000-8000-0000000000e1',
  reversesMovementId: null,
  isOverdraft: false,
  note: 'October rent',
  createdById: USER_ID,
  createdAt: new Date('2026-10-06T09:00:00.000Z'),
};

describe('CashService', () => {
  let service: CashService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<CashService>(CashService);

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    // getCashMovements reads through this.prisma directly, not tx.
    prismaStub.cashMovement.findFirst.mockResolvedValue(null);
    prismaStub.cashMovement.findMany.mockResolvedValue([]);
    prismaStub.cashMovement.count.mockResolvedValue(0);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOpeningCash', () => {
    it('locks the shop row then writes one OPENING_CASH IN row', async () => {
      const res = await service.createOpeningCash(
        { amount: 50000000, date: '2026-10-01', notes: 'Day one' },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Opening cash recorded successfully',
      });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: {
          shopId: SHOP_ID,
          type: 'OPENING_CASH',
          direction: 'IN',
          amount: 50000000n,
          movementDate: new Date('2026-10-01'),
          note: 'Day one',
          createdById: USER_ID,
        },
      });
    });

    it('defaults the movement date to the current business day', async () => {
      await service.createOpeningCash({ amount: 100 }, SHOP_ID, USER_ID);

      expect(tx.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementDate: new Date(businessToday()),
            note: null,
          }),
        }),
      );
    });

    it('rejects a second opening-cash entry and writes nothing', async () => {
      tx.cashMovement.findFirst.mockResolvedValue({ id: 'cm-existing' });

      const err = await service
        .createOpeningCash({ amount: 50000000 }, SHOP_ID, USER_ID)
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        error: 'Opening cash already recorded',
      });
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('404s when the shop row does not exist', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.createOpeningCash({ amount: 50000000 }, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('createOwnerInvestment', () => {
    it('writes one OWNER_INVESTMENT IN row and needs no transaction', async () => {
      const res = await service.createOwnerInvestment(
        { amount: 20000000, date: '2026-10-08', notes: 'Restock money' },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Owner investment recorded successfully',
      });
      expect(prismaStub.$transaction).not.toHaveBeenCalled();
      expect(prismaStub.cashMovement.create).toHaveBeenCalledWith({
        data: {
          shopId: SHOP_ID,
          type: 'OWNER_INVESTMENT',
          direction: 'IN',
          amount: 20000000n,
          movementDate: new Date('2026-10-08'),
          note: 'Restock money',
          createdById: USER_ID,
        },
      });
    });

    it('defaults the date to the current business day and blanks the note', async () => {
      await service.createOwnerInvestment({ amount: 100 }, SHOP_ID, USER_ID);

      expect(prismaStub.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementDate: new Date(businessToday()),
            note: null,
          }),
        }),
      );
    });
  });

  describe('createOwnerWithdrawal', () => {
    it('locks the shop row and writes one OWNER_WITHDRAWAL OUT row when cash allows', async () => {
      const res = await service.createOwnerWithdrawal(
        { amount: 5000000, date: '2026-10-08' },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Owner withdrawal recorded successfully',
      });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.cashMovement.aggregate).toHaveBeenCalledTimes(2); // IN and OUT
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: {
          shopId: SHOP_ID,
          type: 'OWNER_WITHDRAWAL',
          direction: 'OUT',
          amount: 5000000n,
          movementDate: new Date('2026-10-08'),
          note: null,
          isOverdraft: false,
          createdById: USER_ID,
        },
      });
    });

    it('prompts with a 200 shortfall and writes nothing when the drawer cannot cover it', async () => {
      // Cash IN 100000000, OUT 97000000 → balance 3000000; withdrawing 5000000
      tx.cashMovement.aggregate.mockImplementation(
        ({ where }: { where: { direction?: string } }) =>
          Promise.resolve({
            _sum: {
              amount: where.direction === 'IN' ? 100000000n : 97000000n,
            },
          }),
      );

      const res = await service.createOwnerWithdrawal(
        { amount: 5000000 },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        confirmOverdraft: true,
        shortfall: 2000000,
        message:
          'This withdrawal would take your cash below zero by 2000000 paisa. Send confirmOverdraft: true to save it anyway.',
      });
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('saves the row with isOverdraft when the owner confirms the warning', async () => {
      tx.cashMovement.aggregate.mockImplementation(
        ({ where }: { where: { direction?: string } }) =>
          Promise.resolve({
            _sum: {
              amount: where.direction === 'IN' ? 100000000n : 97000000n,
            },
          }),
      );

      const res = await service.createOwnerWithdrawal(
        { amount: 5000000, confirmOverdraft: true },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Owner withdrawal recorded successfully',
      });
      expect(tx.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'OWNER_WITHDRAWAL',
            direction: 'OUT',
            isOverdraft: true,
          }),
        }),
      );
    });

    it('404s when the shop row does not exist and writes nothing', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.createOwnerWithdrawal({ amount: 5000000 }, SHOP_ID, USER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('getCashMovements', () => {
    it('scopes to the shop, applies type/direction and returns mapped rows', async () => {
      prismaStub.cashMovement.findMany.mockResolvedValue([movementRow]);
      prismaStub.cashMovement.count.mockResolvedValue(1);

      const res = await service.getCashMovements(
        { type: 'EXPENSE', direction: 'OUT', page: 2, pageSize: 20 } as any,
        SHOP_ID,
      );

      expect(prismaStub.cashMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: SHOP_ID, type: 'EXPENSE', direction: 'OUT' },
          skip: 20,
          take: 20,
          orderBy: { movementDate: 'desc' },
        }),
      );
      expect(res).toEqual({
        page: 2,
        pageSize: 20,
        total: 1,
        items: [
          {
            id: 'cm-1',
            shopId: SHOP_ID,
            type: 'EXPENSE',
            direction: 'OUT',
            amount: 500000,
            movementDate: '2026-10-06T00:00:00.000Z',
            referenceType: 'EXPENSE',
            referenceId: '01924f0a-0000-7000-8000-0000000000e1',
            reversesMovementId: null,
            isOverdraft: false,
            note: 'October rent',
            createdById: USER_ID,
            createdAt: movementRow.createdAt,
          },
        ],
      });
    });

    it('turns from/to into business-day bounds on movementDate', async () => {
      await service.getCashMovements(
        { from: '2026-10-01', to: '2026-10-31' },
        SHOP_ID,
      );

      expect(prismaStub.cashMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            AND: [
              { movementDate: { gte: businessDayRange('2026-10-01').start } },
              { movementDate: { lt: businessDayRange('2026-10-31').end } },
            ],
          },
        }),
      );
    });

    it('searches the note and honours sortBy/sortOrder', async () => {
      await service.getCashMovements(
        { search: '  rent ', sortBy: 'amount', sortOrder: 'asc' } as any,
        SHOP_ID,
      );

      expect(prismaStub.cashMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            note: { contains: 'rent', mode: 'insensitive' },
          },
          orderBy: { amount: 'asc' },
        }),
      );
    });
  });
});

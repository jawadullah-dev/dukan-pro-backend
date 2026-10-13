import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CashReconciliationsService } from './cash-reconciliations.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { businessToday } from '../../helpers/date.helper.js';

const SHOP_ID = 'shop-1';
const USER_ID = 'user-1';

const prismaStub = {
  cashMovement: {
    create: jest.fn(),
    aggregate: jest.fn(),
  },
  cashReconciliation: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

interface TxStub {
  $queryRaw: jest.Mock;
  cashMovement: {
    create: jest.Mock;
    aggregate: jest.Mock;
  };
  cashReconciliation: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    count: jest.Mock;
  };
}

function makeTx(overrides: Partial<TxStub> = {}): TxStub {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: SHOP_ID }]),
    cashMovement: {
      create: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      aggregate: jest.fn(({ where }: { where: { direction?: string } }) =>
        Promise.resolve({
          _sum: {
            amount: where.direction === 'IN' ? 100000000n : 0n,
          },
        }),
      ),
    },
    cashReconciliation: {
      create: jest.fn().mockResolvedValue({ id: 'rec-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides,
  };
}

const reconciliationRow = {
  id: 'rec-1',
  shopId: SHOP_ID,
  systemCash: 100000000n,
  countedCash: 100000000n,
  difference: 0n,
  reason: null,
  reconciledAt: new Date('2026-10-08T12:00:00.000Z'),
  createdById: USER_ID,
};

describe('CashReconciliationsService', () => {
  let service: CashReconciliationsService;
  let tx: TxStub;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashReconciliationsService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<CashReconciliationsService>(
      CashReconciliationsService,
    );

    tx = makeTx();
    prismaStub.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
      cb(tx),
    );
    prismaStub.cashReconciliation.findFirst.mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createReconciliation', () => {
    it('locks the shop, stores a matching count and writes NO movement', async () => {
      const res = await service.createReconciliation(
        { countedCash: 100000000 },
        SHOP_ID,
        USER_ID,
      );

      expect(res).toEqual({
        status: true,
        message: 'Cash reconciliation recorded successfully',
      });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.cashReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            shopId: SHOP_ID,
            systemCash: 100000000n,
            countedCash: 100000000n,
            difference: 0n,
            reason: null,
            createdById: USER_ID,
          },
        }),
      );
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('writes an IN adjustment when the drawer has more than the system says', async () => {
      await service.createReconciliation(
        { countedCash: 100050000, reason: 'Found hidden cash' },
        SHOP_ID,
        USER_ID,
      );

      expect(tx.cashReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            systemCash: 100000000n,
            countedCash: 100050000n,
            difference: 50000n,
            reason: 'Found hidden cash',
          }),
        }),
      );
      expect(tx.cashMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          type: 'RECONCILIATION_ADJUSTMENT',
          direction: 'IN',
          amount: 50000n,
          movementDate: new Date(businessToday()),
          referenceType: 'RECONCILIATION',
          referenceId: 'rec-1',
          createdById: USER_ID,
        }),
      });
    });

    it('writes an OUT adjustment when the drawer has less than the system says', async () => {
      await service.createReconciliation(
        { countedCash: 99900000, reason: 'Wrong change given' },
        SHOP_ID,
        USER_ID,
      );

      expect(tx.cashReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            difference: -100000n,
          }),
        }),
      );
      expect(tx.cashMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RECONCILIATION_ADJUSTMENT',
            direction: 'OUT',
            amount: 100000n,
          }),
        }),
      );
    });

    it('rejects a non-zero difference without a reason', async () => {
      const err = await service
        .createReconciliation({ countedCash: 100050000 }, SHOP_ID, USER_ID)
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        error: 'Reason required for the difference',
      });
      expect(tx.cashReconciliation.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only reason the same way', async () => {
      const err = await service
        .createReconciliation(
          { countedCash: 100050000, reason: '   ' },
          SHOP_ID,
          USER_ID,
        )
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(tx.cashReconciliation.create).not.toHaveBeenCalled();
    });

    it('404s when the shop row does not exist and writes nothing', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(
        service.createReconciliation(
          { countedCash: 100000000 },
          SHOP_ID,
          USER_ID,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.cashReconciliation.create).not.toHaveBeenCalled();
      expect(tx.cashMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('getReconciliations', () => {
    it('scopes to the shop, maps rows and honours search/sort', async () => {
      prismaStub.cashReconciliation.findMany.mockResolvedValue([
        reconciliationRow,
      ]);
      prismaStub.cashReconciliation.count.mockResolvedValue(1);

      const res = await service.getReconciliations(
        { search: 'change', sortBy: 'difference', sortOrder: 'asc' } as any,
        SHOP_ID,
      );

      expect(prismaStub.cashReconciliation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            reason: { contains: 'change', mode: 'insensitive' },
          },
          orderBy: { difference: 'asc' },
        }),
      );
      expect(res.items[0]).toEqual({
        id: 'rec-1',
        shopId: SHOP_ID,
        systemCash: 100000000,
        countedCash: 100000000,
        difference: 0,
        reason: null,
        reconciledAt: reconciliationRow.reconciledAt,
        createdById: USER_ID,
      });
    });

    it('turns from/to into business-day bounds on reconciledAt', async () => {
      await service.getReconciliations(
        { from: '2026-10-01', to: '2026-10-31' },
        SHOP_ID,
      );

      expect(prismaStub.cashReconciliation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            AND: [
              { reconciledAt: { gte: expect.any(Date) } },
              { reconciledAt: { lt: expect.any(Date) } },
            ],
          },
        }),
      );
    });
  });

  describe('getReconciliationById', () => {
    it('404s when the row is missing or belongs to another shop', async () => {
      await expect(
        service.getReconciliationById('missing', SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the mapped row when found', async () => {
      prismaStub.cashReconciliation.findFirst.mockResolvedValue(
        reconciliationRow,
      );

      const res = await service.getReconciliationById('rec-1', SHOP_ID);

      expect(prismaStub.cashReconciliation.findFirst).toHaveBeenCalledWith({
        where: { id: 'rec-1', shopId: SHOP_ID },
      });
      expect(res.difference).toBe(0);
    });
  });
});

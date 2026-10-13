import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CashReconciliationsController } from './cash-reconciliations.controller.js';
import { CashReconciliationsService } from '../services/cash-reconciliations.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

const prismaStub = {
  cashMovement: { create: jest.fn(), aggregate: jest.fn() },
  cashReconciliation: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('CashReconciliationsController', () => {
  let controller: CashReconciliationsController;
  let cashReconciliationsService: CashReconciliationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashReconciliationsController],
      providers: [
        CashReconciliationsService,
        { provide: PrismaService, useValue: prismaStub },
        {
          provide: AuthGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn(), sign: jest.fn() },
        },
        {
          provide: AppConfigurationService,
          useValue: {
            get: jest.fn().mockReturnValue({ jwtSecret: 'test-secret' }),
            auth: { jwtSecret: 'test-secret' },
          },
        },
      ],
    }).compile();

    controller = module.get<CashReconciliationsController>(
      CashReconciliationsController,
    );
    cashReconciliationsService = module.get<CashReconciliationsService>(
      CashReconciliationsService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId and userId from the JWT, never from the body', async () => {
    const spy = jest
      .spyOn(cashReconciliationsService, 'createReconciliation')
      .mockResolvedValue({
        status: true,
        message: 'Cash reconciliation recorded successfully',
      });

    await controller.createReconciliation({ countedCash: 100000000 }, {
      user: { shopId: 'shop-from-jwt', userId: 'user-1' },
    } as any);

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('wraps a successful create in the documented envelope', async () => {
    jest
      .spyOn(cashReconciliationsService, 'createReconciliation')
      .mockResolvedValue({
        status: true,
        message: 'Cash reconciliation recorded successfully',
      });

    const res = await controller.createReconciliation(
      { countedCash: 100000000 },
      {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any,
    );

    expect(res.message).toBe('Cash reconciliation recorded successfully');
    expect(res.data).toEqual({
      status: true,
      message: 'Cash reconciliation recorded successfully',
    });
  });

  it('preserves a service 400 (missing reason)', async () => {
    jest
      .spyOn(cashReconciliationsService, 'createReconciliation')
      .mockRejectedValue(
        new BadRequestException('Reason required for the difference'),
      );

    await expect(
      controller.createReconciliation({ countedCash: 100050000 }, {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('scopes a list request to the JWT shop', async () => {
    const spy = jest
      .spyOn(cashReconciliationsService, 'getReconciliations')
      .mockResolvedValue({ page: 1, pageSize: 10, total: 0, items: [] });

    await controller.getReconciliations({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest
      .spyOn(cashReconciliationsService, 'getReconciliations')
      .mockResolvedValue({ page: 1, pageSize: 10, total: 0, items: [] });

    const res = await controller.getReconciliations({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Cash reconciliations fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('scopes a get-by-id to the JWT shop', async () => {
    const spy = jest
      .spyOn(cashReconciliationsService, 'getReconciliationById')
      .mockResolvedValue({ id: 'rec-1' } as any);

    await controller.getReconciliationById('rec-1', {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith('rec-1', 'shop-7');
  });

  it('preserves a service 404 on get-by-id', async () => {
    jest
      .spyOn(cashReconciliationsService, 'getReconciliationById')
      .mockRejectedValue(new NotFoundException('Reconciliation not found'));

    await expect(
      controller.getReconciliationById('missing', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(cashReconciliationsService, 'createReconciliation')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.createReconciliation({ countedCash: 100000000 }, {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

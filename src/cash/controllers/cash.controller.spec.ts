import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CashController } from './cash.controller.js';
import { CashService } from '../services/cash.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

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

/** Minimal express Response that records the status the controller sets. */
function resStub() {
  return { status: jest.fn().mockReturnThis() } as any;
}

describe('CashController', () => {
  let controller: CashController;
  let cashService: CashService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CashController],
      providers: [
        CashService,
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

    controller = module.get<CashController>(CashController);
    cashService = module.get<CashService>(CashService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId and userId from the JWT, never from the body', async () => {
    const spy = jest.spyOn(cashService, 'createOpeningCash').mockResolvedValue({
      status: true,
      message: 'Opening cash recorded successfully',
    });

    await controller.createOpeningCash({ amount: 50000000 }, {
      user: { shopId: 'shop-from-jwt', userId: 'user-1' },
    } as any);

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('wraps a successful create in the documented envelope', async () => {
    jest.spyOn(cashService, 'createOpeningCash').mockResolvedValue({
      status: true,
      message: 'Opening cash recorded successfully',
    });

    const res = await controller.createOpeningCash({ amount: 50000000 }, {
      user: { shopId: 'shop-1', userId: 'user-1' },
    } as any);

    expect(res.message).toBe('Opening cash recorded successfully');
    expect(res.data).toEqual({
      status: true,
      message: 'Opening cash recorded successfully',
    });
  });

  it('preserves the 400 when opening cash is already set', async () => {
    jest
      .spyOn(cashService, 'createOpeningCash')
      .mockRejectedValue(
        new BadRequestException('Opening cash already recorded'),
      );

    await expect(
      controller.createOpeningCash({ amount: 50000000 }, {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 500 for an unexpected create error', async () => {
    jest
      .spyOn(cashService, 'createOpeningCash')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.createOpeningCash({ amount: 50000000 }, {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('scopes a movements list to the JWT shop', async () => {
    const spy = jest.spyOn(cashService, 'getCashMovements').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    await controller.getCashMovements({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });

  it('wraps a successful movements list in the documented envelope', async () => {
    jest.spyOn(cashService, 'getCashMovements').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getCashMovements({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Cash movements fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('preserves a service 404', async () => {
    jest
      .spyOn(cashService, 'getCashMovements')
      .mockRejectedValue(new NotFoundException('Shop not found'));

    await expect(
      controller.getCashMovements({}, { user: { shopId: 'shop-1' } } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('passes shopId and userId from the JWT for an investment', async () => {
    const spy = jest
      .spyOn(cashService, 'createOwnerInvestment')
      .mockResolvedValue({
        status: true,
        message: 'Owner investment recorded successfully',
      });

    await controller.createOwnerInvestment({ amount: 20000000 }, {
      user: { shopId: 'shop-from-jwt', userId: 'user-1' },
    } as any);

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('answers 201 for a successful owner investment', async () => {
    jest.spyOn(cashService, 'createOwnerInvestment').mockResolvedValue({
      status: true,
      message: 'Owner investment recorded successfully',
    });

    const res = await controller.createOwnerInvestment({ amount: 20000000 }, {
      user: { shopId: 'shop-1', userId: 'user-1' },
    } as any);

    expect(res.message).toBe('Owner investment recorded successfully');
    expect(res.data).toEqual({
      status: true,
      message: 'Owner investment recorded successfully',
    });
  });

  it('answers 201 for a withdrawal that closed successfully', async () => {
    jest.spyOn(cashService, 'createOwnerWithdrawal').mockResolvedValue({
      status: true,
      message: 'Owner withdrawal recorded successfully',
    });
    const http = resStub();

    await controller.createOwnerWithdrawal(
      { amount: 5000000 },
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(http.status).toHaveBeenCalledWith(201);
  });

  it('answers 200 for the overdraft prompt because nothing was written', async () => {
    jest.spyOn(cashService, 'createOwnerWithdrawal').mockResolvedValue({
      confirmOverdraft: true,
      shortfall: 2000000,
      message:
        'This withdrawal would take your cash below zero by 2000000 paisa. Send confirmOverdraft: true to save it anyway.',
    } as any);
    const http = resStub();

    const res = await controller.createOwnerWithdrawal(
      { amount: 5000000 },
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(res.data).toEqual(
      expect.objectContaining({ confirmOverdraft: true, shortfall: 2000000 }),
    );
    expect(http.status).toHaveBeenCalledWith(200);
  });

  it('returns 500 for an unexpected investment error', async () => {
    jest
      .spyOn(cashService, 'createOwnerInvestment')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.createOwnerInvestment({ amount: 20000000 }, {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

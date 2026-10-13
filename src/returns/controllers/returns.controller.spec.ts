import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ReturnsController } from './returns.controller.js';
import { ReturnsService } from '../services/returns.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

const prismaStub = {
  sale: { findFirst: jest.fn() },
  payment: { aggregate: jest.fn() },
  saleReturn: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    count: jest.fn(),
  },
  refund: { aggregate: jest.fn() },
  returnItem: { findMany: jest.fn() },
  cashMovement: { aggregate: jest.fn() },
  $transaction: jest.fn(),
};

describe('ReturnsController', () => {
  let controller: ReturnsController;
  let returnsService: ReturnsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReturnsController],
      providers: [
        ReturnsService,
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

    controller = module.get<ReturnsController>(ReturnsController);
    returnsService = module.get<ReturnsService>(ReturnsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('scopes a list request to the JWT shop', async () => {
    const spy = jest.spyOn(returnsService, 'getReturns').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    await controller.getReturns({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(returnsService, 'getReturns').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getReturns({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Returns fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('preserves a service 404 on getReturnById', async () => {
    jest
      .spyOn(returnsService, 'getReturnById')
      .mockRejectedValue(new NotFoundException('Return not found'));

    await expect(
      controller.getReturnById('missing', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(returnsService, 'getReturnById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getReturnById('ret-1', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

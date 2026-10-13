import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SalesController } from './sales.controller.js';
import { SalesService } from '../services/sales.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { CancelImpactResponseDto } from '../../common-dto/response/cancel-impact.dto.js';

const prismaStub = {
  sale: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

describe('SalesController', () => {
  let controller: SalesController;
  let salesService: SalesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        SalesService,
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

    controller = module.get<SalesController>(SalesController);
    salesService = module.get<SalesService>(SalesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId and userId from the JWT, never from the body', async () => {
    const spy = jest
      .spyOn(salesService, 'createSale')
      .mockResolvedValue({ status: true, message: 'Sale created' });

    await controller.createSale(
      { clientRequestId: 'req-1' } as any,
      { user: { shopId: 'shop-from-jwt', userId: 'user-1' } } as any,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('surfaces the idempotent replay message', async () => {
    jest
      .spyOn(salesService, 'createSale')
      .mockResolvedValue({ status: true, message: 'Sale already saved' });

    const res = await controller.createSale(
      { clientRequestId: 'r' } as any,
      {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any,
    );

    expect(res.message).toBe('Sale already saved');
    expect(res.data).toEqual({
      status: true,
      message: 'Sale already saved',
    });
  });

  it('preserves a service 400 response', async () => {
    jest
      .spyOn(salesService, 'createSale')
      .mockRejectedValue(new BadRequestException('bad input'));

    await expect(
      controller.createSale(
        {} as any,
        {
          user: { shopId: 'shop-1', userId: 'user-1' },
        } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(salesService, 'getSaleById')
      .mockRejectedValue(new NotFoundException('Sale not found'));

    await expect(
      controller.getSaleById('missing', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(salesService, 'getSaleById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getSaleById('s-1', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(salesService, 'getSales').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getSales({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Sales fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('scopes a list request to the JWT shop', async () => {
    const spy = jest.spyOn(salesService, 'getSales').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    await controller.getSales({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });

  it('fetches cancel impact scoped to the JWT shop', async () => {
    const impact = {
      recordType: 'SALE',
      stockItems: [],
    } as unknown as CancelImpactResponseDto;
    const spy = jest
      .spyOn(salesService, 'getCancelImpact')
      .mockResolvedValue(impact);

    const res = await controller.getCancelImpact('sale-9', {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith('sale-9', 'shop-7');
    expect(res.message).toBe('Cancel impact fetched successfully');
    expect(res.data).toEqual(impact);
  });
});

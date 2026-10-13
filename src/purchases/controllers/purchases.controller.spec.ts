import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from '../services/purchases.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { CancelImpactResponseDto } from '../../common-dto/response/cancel-impact.dto.js';

const prismaStub = {
  purchase: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

/** Minimal express Response that records the status the controller sets. */
function resStub() {
  return { status: jest.fn().mockReturnThis() } as any;
}

describe('PurchasesController', () => {
  let controller: PurchasesController;
  let purchasesService: PurchasesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchasesController],
      providers: [
        PurchasesService,
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

    controller = module.get<PurchasesController>(PurchasesController);
    purchasesService = module.get<PurchasesService>(PurchasesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId and userId from the JWT, never from the body', async () => {
    const spy = jest
      .spyOn(purchasesService, 'createPurchase')
      .mockResolvedValue({ status: true, message: 'Purchase created' });

    await controller.createPurchase(
      { clientRequestId: 'req-1' } as any,
      {
        user: { shopId: 'shop-from-jwt', userId: 'user-1' },
      } as any,
      resStub(),
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('returns 201 when a row was actually written', async () => {
    jest
      .spyOn(purchasesService, 'createPurchase')
      .mockResolvedValue({ status: true, message: 'Purchase created' });
    const http = resStub();

    await controller.createPurchase(
      { clientRequestId: 'r' } as any,
      {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any,
      http,
    );

    expect(http.status).toHaveBeenCalledWith(201);
  });

  it('surfaces the overdraft prompt in the top-level message', async () => {
    jest.spyOn(purchasesService, 'createPurchase').mockResolvedValue({
      confirmOverdraft: true,
      shortfall: 9500000,
      message: 'This payment would take your cash below zero',
    });
    const http = resStub();

    const res = await controller.createPurchase(
      { clientRequestId: 'r' } as any,
      {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any,
      http,
    );

    expect(res.message).toBe('This payment would take your cash below zero');
    expect(res.data).toEqual(
      expect.objectContaining({ confirmOverdraft: true, shortfall: 9500000 }),
    );
    // Nothing was created, so the prompt must not claim 201.
    expect(http.status).toHaveBeenCalledWith(200);
  });

  it('preserves a service 400 response', async () => {
    jest
      .spyOn(purchasesService, 'createPurchase')
      .mockRejectedValue(new BadRequestException('bad input'));

    await expect(
      controller.createPurchase(
        {} as any,
        {
          user: { shopId: 'shop-1', userId: 'user-1' },
        } as any,
        resStub(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(purchasesService, 'getPurchaseById')
      .mockRejectedValue(new NotFoundException('Purchase not found'));

    await expect(
      controller.getPurchaseById('missing', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(purchasesService, 'getPurchaseById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getPurchaseById('p-1', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(purchasesService, 'getPurchases').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getPurchases({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Purchases fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('scopes a list request to the JWT shop', async () => {
    const spy = jest.spyOn(purchasesService, 'getPurchases').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    await controller.getPurchases({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });

  it('fetches cancel impact scoped to the JWT shop', async () => {
    const impact = {
      recordType: 'PURCHASE',
      stockItems: [],
    } as unknown as CancelImpactResponseDto;
    const spy = jest
      .spyOn(purchasesService, 'getCancelImpact')
      .mockResolvedValue(impact);

    const res = await controller.getCancelImpact('purchase-9', {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith('purchase-9', 'shop-7');
    expect(res.message).toBe('Cancel impact fetched successfully');
    expect(res.data).toEqual(impact);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SaleReturnsController } from './sale-returns.controller.js';
import { ReturnsService } from '../services/returns.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

const prismaStub = {
  sale: { findFirst: jest.fn() },
  payment: { aggregate: jest.fn() },
  saleReturn: { findMany: jest.fn(), aggregate: jest.fn() },
  refund: { aggregate: jest.fn() },
  returnItem: { findMany: jest.fn() },
  cashMovement: { aggregate: jest.fn() },
  $transaction: jest.fn(),
};

/** Minimal express Response that records the status the controller sets. */
function resStub() {
  return { status: jest.fn().mockReturnThis() } as any;
}

describe('SaleReturnsController', () => {
  let controller: SaleReturnsController;
  let returnsService: ReturnsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SaleReturnsController],
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

    controller = module.get<SaleReturnsController>(SaleReturnsController);
    returnsService = module.get<ReturnsService>(ReturnsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the saleId and shopId from the route and JWT, never from the body', async () => {
    const spy = jest.spyOn(returnsService, 'createReturn').mockResolvedValue({
      status: true,
      message: 'Return recorded successfully',
    });

    await controller.createReturn(
      'sale-9',
      { reason: 'wrong', returnDate: '2026-10-08', items: [] },
      { user: { shopId: 'shop-from-jwt', userId: 'user-1' } } as any,
      resStub(),
    );

    expect(spy).toHaveBeenCalledWith(
      'sale-9',
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('returns 201 when a row was actually written', async () => {
    jest.spyOn(returnsService, 'createReturn').mockResolvedValue({
      status: true,
      message: 'Return recorded successfully',
    });
    const http = resStub();

    await controller.createReturn(
      'sale-1',
      {} as any,
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(http.status).toHaveBeenCalledWith(201);
  });

  it('answers 200 for the overdraft prompt because nothing was written', async () => {
    jest.spyOn(returnsService, 'createReturn').mockResolvedValue({
      confirmOverdraft: true,
      shortfall: 4000000,
      message:
        'This refund would take your cash below zero by 4000000 paisa. Send confirmOverdraft: true to save it anyway.',
    } as any);
    const http = resStub();

    const res = await controller.createReturn(
      'sale-1',
      {} as any,
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(res.data).toEqual(
      expect.objectContaining({ confirmOverdraft: true, shortfall: 4000000 }),
    );
    expect(http.status).toHaveBeenCalledWith(200);
  });

  it('scopes the dry run to the JWT shop', async () => {
    const spy = jest
      .spyOn(returnsService, 'previewReturn')
      .mockResolvedValue({ saleId: 'sale-1' } as any);

    await controller.previewReturn('sale-1', { items: [] }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith('sale-1', expect.anything(), 'shop-7');
  });

  it('preserves a service 400', async () => {
    jest
      .spyOn(returnsService, 'createReturn')
      .mockRejectedValue(new BadRequestException('too many'));

    await expect(
      controller.createReturn(
        'sale-1',
        {} as any,
        { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
        resStub(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves a service 404 on the dry run', async () => {
    jest
      .spyOn(returnsService, 'previewReturn')
      .mockRejectedValue(new NotFoundException('Sale not found'));

    await expect(
      controller.previewReturn(
        'missing',
        { items: [] } as any,
        { user: { shopId: 'shop-1' } } as any,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(returnsService, 'createReturn')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.createReturn(
        'sale-1',
        {} as any,
        { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
        resStub(),
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

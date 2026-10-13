import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupplierPaymentsController } from './supplier-payments.controller.js';
import { SupplierPaymentsService } from '../services/supplier-payments.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { CancelImpactResponseDto } from '../../common-dto/response/cancel-impact.dto.js';

const prismaStub = {
  supplierPayment: {
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

describe('SupplierPaymentsController', () => {
  let controller: SupplierPaymentsController;
  let service: SupplierPaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupplierPaymentsController],
      providers: [
        SupplierPaymentsService,
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

    controller = module.get<SupplierPaymentsController>(
      SupplierPaymentsController,
    );
    service = module.get<SupplierPaymentsService>(SupplierPaymentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId and userId from the JWT, never from the body', async () => {
    const spy = jest
      .spyOn(service, 'createSupplierPayment')
      .mockResolvedValue({ status: true, message: 'recorded' });

    await controller.createSupplierPayment(
      { supplierId: 'sup-1' } as any,
      { user: { shopId: 'shop-from-jwt', userId: 'user-1' } } as any,
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
      .spyOn(service, 'createSupplierPayment')
      .mockResolvedValue({ status: true, message: 'recorded' });
    const http = resStub();

    await controller.createSupplierPayment(
      { supplierId: 'sup-1' } as any,
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(http.status).toHaveBeenCalledWith(201);
  });

  it('surfaces the overdraft prompt in the top-level message and answers 200', async () => {
    jest.spyOn(service, 'createSupplierPayment').mockResolvedValue({
      confirmOverdraft: true,
      shortfall: 8500000,
      message: 'This payment would take your cash below zero',
    });
    const http = resStub();

    const res = await controller.createSupplierPayment(
      { supplierId: 'sup-1' } as any,
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(res.message).toBe('This payment would take your cash below zero');
    expect(res.data).toEqual(
      expect.objectContaining({ confirmOverdraft: true, shortfall: 8500000 }),
    );
    // Nothing was created, so the prompt must not claim 201.
    expect(http.status).toHaveBeenCalledWith(200);
  });

  it('preserves a service 400 response', async () => {
    jest
      .spyOn(service, 'createSupplierPayment')
      .mockRejectedValue(new BadRequestException('too much'));

    await expect(
      controller.createSupplierPayment(
        {} as any,
        { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
        resStub(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(service, 'getSupplierPayable')
      .mockRejectedValue(new NotFoundException('Supplier not found'));

    await expect(
      controller.getSupplierPayable('missing', {
        user: { shopId: 's' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(service, 'getSupplierPayable')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getSupplierPayable('sup-1', { user: { shopId: 's' } } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(service, 'getSupplierPayments').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getSupplierPayments({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Supplier payments fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('scopes a payable request to the JWT shop', async () => {
    const spy = jest.spyOn(service, 'getSupplierPayable').mockResolvedValue({
      supplierId: 'sup-1',
      supplierName: 'ABC Mobiles',
      openingBalance: 0,
      openingRemaining: 0,
      totalPurchases: 0,
      totalPaid: 0,
      payable: 0,
      unpaidPurchases: [],
    });

    await controller.getSupplierPayable('sup-1', {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith('sup-1', 'shop-7');
  });

  it('fetches cancel impact scoped to the JWT shop', async () => {
    const impact = {
      recordType: 'SUPPLIER_PAYMENT',
      stockItems: [],
    } as unknown as CancelImpactResponseDto;
    const spy = jest
      .spyOn(service, 'getCancelImpact')
      .mockResolvedValue(impact);

    const res = await controller.getCancelImpact('sp-9', {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith('sp-9', 'shop-7');
    expect(res.message).toBe('Cancel impact fetched successfully');
    expect(res.data).toEqual(impact);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from '../services/payments.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { CancelImpactResponseDto } from '../../common-dto/response/cancel-impact.dto.js';

const prismaStub = {
  payment: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: PaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        PaymentsService,
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

    controller = module.get<PaymentsController>(PaymentsController);
    paymentsService = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId and userId from the JWT, never from the body', async () => {
    const spy = jest
      .spyOn(paymentsService, 'createPayment')
      .mockResolvedValue({ status: true, message: 'Payment recorded' });

    await controller.createPayment(
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
      .spyOn(paymentsService, 'createPayment')
      .mockResolvedValue({ status: true, message: 'Payment already saved' });

    const res = await controller.createPayment(
      { clientRequestId: 'r' } as any,
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
    );

    expect(res.message).toBe('Payment already saved');
    expect(res.data).toEqual({
      status: true,
      message: 'Payment already saved',
    });
  });

  it('preserves a service 400 response', async () => {
    jest
      .spyOn(paymentsService, 'createPayment')
      .mockRejectedValue(new BadRequestException('too much'));

    await expect(
      controller.createPayment(
        {} as any,
        { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(paymentsService, 'getPaymentById')
      .mockRejectedValue(new NotFoundException('Payment not found'));

    await expect(
      controller.getPaymentById('missing', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(paymentsService, 'getPaymentById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getPaymentById('p-1', { user: { shopId: 'shop-1' } } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(paymentsService, 'getPayments').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getPayments({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Payments fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('scopes a list request to the JWT shop', async () => {
    const spy = jest.spyOn(paymentsService, 'getPayments').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    await controller.getPayments({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });

  it('fetches cancel impact scoped to the JWT shop', async () => {
    const impact = {
      recordType: 'PAYMENT',
      stockItems: [],
    } as unknown as CancelImpactResponseDto;
    const spy = jest
      .spyOn(paymentsService, 'getCancelImpact')
      .mockResolvedValue(impact);

    const res = await controller.getCancelImpact('payment-9', {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith('payment-9', 'shop-7');
    expect(res.message).toBe('Cancel impact fetched successfully');
    expect(res.data).toEqual(impact);
  });
});

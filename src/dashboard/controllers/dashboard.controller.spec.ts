import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { InternalServerErrorException } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from '../services/dashboard.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

const prismaStub = {
  sale: { aggregate: jest.fn() },
  saleItem: { findMany: jest.fn() },
  expense: { aggregate: jest.fn() },
  customer: { aggregate: jest.fn() },
  payment: { aggregate: jest.fn() },
  supplier: { aggregate: jest.fn() },
  purchase: { aggregate: jest.fn() },
  supplierPayment: { aggregate: jest.fn() },
  cashMovement: { groupBy: jest.fn() },
  product: { findMany: jest.fn() },
};

describe('DashboardController', () => {
  let controller: DashboardController;
  let dashboardService: DashboardService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        DashboardService,
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

    controller = module.get<DashboardController>(DashboardController);
    dashboardService = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('scopes the dashboard to the shop from the JWT, never the query', async () => {
    const spy = jest.spyOn(dashboardService, 'getDashboard').mockResolvedValue({
      period: 'today',
      date: '2026-10-07',
      todaySales: 0,
      todayNetProfit: 0,
      customerUdhar: 0,
      supplierPayable: 0,
      todayExpenses: 0,
      lowStockProducts: 0,
      cashPosition: 0,
      links: {
        todaySales: '/sales',
        todayNetProfit: '/sales',
        customerUdhar: '/customers',
        supplierPayable: '/suppliers',
        todayExpenses: '/expenses',
        lowStockProducts: '/products',
        cashPosition: '/cash/movements',
      },
    });

    await controller.getDashboard({ period: 'today' }, {
      user: { shopId: 'shop-from-jwt' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-from-jwt');
  });

  it('wraps the numbers in the documented envelope', async () => {
    jest.spyOn(dashboardService, 'getDashboard').mockResolvedValue({
      period: 'today',
      date: '2026-10-07',
      todaySales: 12000000,
      todayNetProfit: 1400000,
      customerUdhar: 30000000,
      supplierPayable: 45000000,
      todayExpenses: 500000,
      lowStockProducts: 4,
      cashPosition: 47850000,
      links: {
        todaySales: '/sales?from=2026-10-07&to=2026-10-07',
        todayNetProfit: '/sales?from=2026-10-07&to=2026-10-07',
        customerUdhar: '/customers',
        supplierPayable: '/suppliers',
        todayExpenses: '/expenses?from=2026-10-07&to=2026-10-07',
        lowStockProducts: '/products',
        cashPosition: '/cash/movements',
      },
    });

    const res = await controller.getDashboard({ period: 'today' }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Dashboard fetched successfully');
    expect(res.data).toEqual(
      expect.objectContaining({ todaySales: 12000000, cashPosition: 47850000 }),
    );
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(dashboardService, 'getDashboard')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getDashboard({ period: 'today' }, {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

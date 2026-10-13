import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from '../services/reports.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

const prismaStub = {};

const pageStub = {
  page: 1,
  pageSize: 10,
  total: 0,
  from: '2026-10-01',
  to: '2026-10-31',
  summary: { count: 0 },
  items: [],
};

const req = { user: { shopId: 'shop-1', userId: 'user-1' } } as any;

describe('ReportsController', () => {
  let controller: ReportsController;
  let reportsService: ReportsService;

  const headers: Record<string, string> = {};
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.keys(headers).forEach((k) => delete headers[k]);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        ReportsService,
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

    controller = module.get<ReportsController>(ReportsController);
    reportsService = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it.each([
    ['salesReport', 'sales', 'getSalesReport'],
    ['purchaseReport', 'purchases', 'getPurchaseReport'],
    ['expenseReport', 'expenses', 'getExpenseReport'],
    ['profitReport', 'profit', 'getProfitReport'],
    ['customerReport', 'customers', 'getCustomerReport'],
    ['supplierReport', 'suppliers', 'getSupplierReport'],
    ['inventoryReport', 'inventory', 'getInventoryReport'],
    ['bestSellersReport', 'best-sellers', 'getBestSellersReport'],
  ] as const)(
    '%s scopes to the JWT shop and wraps JSON in the envelope',
    async (method, _name, serviceMethod) => {
      const spy = jest
        .spyOn(reportsService, serviceMethod)
        .mockResolvedValue(pageStub as any);

      const out = await (controller as any)[method](
        { period: 'today' },
        req,
        res,
      );

      expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-1');
      expect(out.message).toBeDefined();
      expect(out.data).toEqual(pageStub);
      expect(headers['Content-Type']).toBeUndefined();
    },
  );

  it.each([
    [
      'salesReport',
      'sales',
      'getSalesReport',
      'sales-2026-10-01-to-2026-10-31.csv',
    ],
    [
      'customerReport',
      'customers',
      'getCustomerReport',
      'customers-2026-10-01-to-2026-10-31.csv',
    ],
  ] as const)(
    '%s returns a text/csv download when format=csv',
    async (method, _name, serviceMethod, filename) => {
      jest
        .spyOn(reportsService, serviceMethod)
        .mockResolvedValue(pageStub as any);

      const out = await (controller as any)[method](
        { period: 'today', format: 'csv' },
        req,
        res,
      );

      expect(headers['Content-Type']).toContain('text/csv');
      expect(headers['Content-Disposition']).toContain(filename);
      expect(typeof out).toBe('string');
      expect(out).not.toHaveProperty('message');
    },
  );

  it('rejects format=pdf until the PDF ticket lands', async () => {
    jest
      .spyOn(reportsService, 'getSalesReport')
      .mockResolvedValue(pageStub as any);

    await expect(
      (controller as any).salesReport(
        { period: 'today', format: 'pdf' },
        req,
        res,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(reportsService, 'getSalesReport')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      (controller as any).salesReport({ period: 'today' }, req, res),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

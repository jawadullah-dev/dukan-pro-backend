import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { businessToday } from '../../helpers/date.helper.js';

const SHOP_ID = 'shop-1';

const prismaStub = {
  sale: { aggregate: jest.fn() },
  saleItem: { findMany: jest.fn() },
  expense: { aggregate: jest.fn() },
  customer: { aggregate: jest.fn() },
  payment: { aggregate: jest.fn() },
  saleReturn: { aggregate: jest.fn() },
  refund: { aggregate: jest.fn() },
  supplier: { aggregate: jest.fn() },
  purchase: { aggregate: jest.fn() },
  supplierPayment: { aggregate: jest.fn() },
  cashMovement: { groupBy: jest.fn() },
  product: { findMany: jest.fn() },
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);

    prismaStub.sale.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });
    prismaStub.saleItem.findMany.mockResolvedValue([]);
    prismaStub.expense.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prismaStub.customer.aggregate.mockResolvedValue({
      _sum: { openingBalance: null },
    });
    prismaStub.payment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prismaStub.saleReturn.aggregate.mockResolvedValue({
      _sum: { returnAmount: null },
    });
    prismaStub.refund.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prismaStub.supplier.aggregate.mockResolvedValue({
      _sum: { openingBalance: null },
    });
    prismaStub.purchase.aggregate.mockResolvedValue({
      _sum: { totalAmount: null },
    });
    prismaStub.supplierPayment.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });
    prismaStub.cashMovement.groupBy.mockResolvedValue([]);
    prismaStub.product.findMany.mockResolvedValue([]);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reads today through the PKT business day and excludes cancelled sales', async () => {
    await service.getDashboard({ period: 'today' }, SHOP_ID);

    const args = prismaStub.sale.aggregate.mock.calls[0][0];
    expect(args.where).toEqual(
      expect.objectContaining({ shopId: SHOP_ID, status: 'ACTIVE' }),
    );
    expect(args.where.saleDate.gte).toBeInstanceOf(Date);
    expect(args.where.saleDate.lte).toBeInstanceOf(Date);
    expect(args.where.saleDate.lte.getTime()).toBe(
      args.where.saleDate.gte.getTime() + 24 * 60 * 60 * 1000,
    );
  });

  it('nets profit as sales − cost − today’s active expenses', async () => {
    prismaStub.sale.aggregate.mockImplementation((args: any) =>
      Promise.resolve({
        _sum: {
          totalAmount: args.where.saleDate
            ? 12000000n // today's sales
            : 30000000n, // all active sales for Udhar
        },
      }),
    );
    prismaStub.saleItem.findMany.mockResolvedValue([
      { unitCost: 5000000n, quantity: 1 },
      { unitCost: 1000000n, quantity: 2 },
    ]);
    prismaStub.expense.aggregate.mockResolvedValue({
      _sum: { amount: 600000n },
    });

    const res = await service.getDashboard({ period: 'today' }, SHOP_ID);

    // 12000000 − (5000000 + 2000000) − 600000 = 4400000
    expect(res.todaySales).toBe(12000000);
    expect(res.todayExpenses).toBe(600000);
    expect(res.todayNetProfit).toBe(4400000);
  });

  it('counts only ACTIVE expenses dated today', async () => {
    await service.getDashboard({ period: 'today' }, SHOP_ID);

    const args = prismaStub.expense.aggregate.mock.calls[0][0];
    expect(args.where).toEqual(
      expect.objectContaining({ shopId: SHOP_ID, status: 'ACTIVE' }),
    );
    expect(args.where.expenseDate.equals).toBeInstanceOf(Date);
    expect(args.where.expenseDate.equals.toISOString().slice(0, 10)).toBe(
      businessToday(),
    );
  });

  it('derives customer Udhar as openings + active sales − active payments', async () => {
    prismaStub.customer.aggregate.mockResolvedValue({
      _sum: { openingBalance: 5000000n },
    });
    prismaStub.sale.aggregate.mockResolvedValue({
      _sum: { totalAmount: 30000000n },
    });
    prismaStub.payment.aggregate.mockResolvedValue({
      _sum: { amount: 10000000n },
    });

    const res = await service.getDashboard({ period: 'today' }, SHOP_ID);

    expect(res.customerUdhar).toBe(25000000);
    expect(prismaStub.payment.aggregate).toHaveBeenCalledWith({
      where: { shopId: SHOP_ID, status: 'ACTIVE' },
      _sum: { amount: true },
    });
  });

  it('subtracts returns and adds refunds to customer Udhar (WF15)', async () => {
    prismaStub.customer.aggregate.mockResolvedValue({
      _sum: { openingBalance: 0n },
    });
    prismaStub.sale.aggregate.mockResolvedValue({
      _sum: { totalAmount: 30000000n },
    });
    prismaStub.payment.aggregate.mockResolvedValue({
      _sum: { amount: 20000000n },
    });
    prismaStub.saleReturn.aggregate.mockResolvedValue({
      _sum: { returnAmount: 8000000n },
    });
    prismaStub.refund.aggregate.mockResolvedValue({
      _sum: { amount: 3000000n },
    });

    const res = await service.getDashboard({ period: 'today' }, SHOP_ID);

    // 0 + 30000000 − 20000000 − 8000000 + 3000000 = 5000000
    expect(res.customerUdhar).toBe(5000000);
    // Only refunds of ACTIVE returns count.
    expect(prismaStub.refund.aggregate).toHaveBeenCalledWith({
      where: { shopId: SHOP_ID, saleReturn: { status: 'ACTIVE' } },
      _sum: { amount: true },
    });
  });

  it('derives supplier payable and never counts opening-stock purchases', async () => {
    prismaStub.supplier.aggregate.mockResolvedValue({
      _sum: { openingBalance: 5000000n },
    });
    prismaStub.purchase.aggregate.mockResolvedValue({
      _sum: { totalAmount: 50000000n },
    });
    prismaStub.supplierPayment.aggregate.mockResolvedValue({
      _sum: { amount: 10000000n },
    });

    const res = await service.getDashboard({ period: 'today' }, SHOP_ID);

    expect(res.supplierPayable).toBe(45000000);
    expect(prismaStub.purchase.aggregate).toHaveBeenCalledWith({
      where: {
        shopId: SHOP_ID,
        status: 'ACTIVE',
        isOpeningStock: false,
      },
      _sum: { totalAmount: true },
    });
  });

  it('counts low-stock accessories by stock and phones by IN_STOCK units', async () => {
    prismaStub.product.findMany.mockImplementation((args: any) => {
      if (args.where.trackingType === 'QUANTITY') {
        return Promise.resolve([
          { lowStockThreshold: 5, stockLevel: { quantityOnHand: 3 } }, // low
          { lowStockThreshold: 2, stockLevel: null }, // 0 → low
          { lowStockThreshold: 1, stockLevel: { quantityOnHand: 7 } }, // ok
        ]);
      }
      return Promise.resolve([
        { lowStockThreshold: 2, _count: { inventoryUnits: 2 } }, // low
        { lowStockThreshold: 2, _count: { inventoryUnits: 10 } }, // ok
      ]);
    });

    const res = await service.getDashboard({ period: 'today' }, SHOP_ID);

    expect(res.lowStockProducts).toBe(3);
    expect(prismaStub.product.findMany).toHaveBeenCalledTimes(2);
    expect(prismaStub.product.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        shopId: SHOP_ID,
        isActive: true,
        trackingType: 'QUANTITY',
      }),
    );
    expect(prismaStub.product.findMany.mock.calls[1][0].where).toEqual(
      expect.objectContaining({
        shopId: SHOP_ID,
        isActive: true,
        trackingType: 'SERIALIZED',
      }),
    );
  });

  it('takes cash position as IN − OUT over every movement, reversals included', async () => {
    prismaStub.cashMovement.groupBy.mockResolvedValue([
      { direction: 'IN', _sum: { amount: 47850000n } },
      { direction: 'OUT', _sum: { amount: 3100000n } },
      { direction: 'IN', _sum: { amount: null } },
    ]);

    const res = await service.getDashboard({ period: 'today' }, SHOP_ID);

    expect(res.cashPosition).toBe(44750000);
    expect(prismaStub.cashMovement.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['direction'],
        where: { shopId: SHOP_ID },
      }),
    );
  });

  it('answers with today’s business date and a drill link per number', async () => {
    const res = await service.getDashboard({ period: 'today' }, SHOP_ID);

    const date = businessToday();
    expect(res.period).toBe('today');
    expect(res.date).toBe(date);
    expect(res.links.todaySales).toBe(`/sales?from=${date}&to=${date}`);
    expect(res.links.todayExpenses).toBe(`/expenses?from=${date}&to=${date}`);
    expect(res.links.customerUdhar).toBe('/customers');
    expect(res.links.supplierPayable).toBe('/suppliers');
    expect(res.links.lowStockProducts).toBe('/products');
    expect(res.links.cashPosition).toBe('/cash/movements');
  });
});

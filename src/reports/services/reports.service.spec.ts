import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { businessToday } from '../../helpers/date.helper.js';

const SHOP_ID = 'shop-1';

const prismaStub = {
  sale: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
  saleItem: { findMany: jest.fn(), groupBy: jest.fn() },
  saleReturn: { findMany: jest.fn() },
  refund: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
  purchase: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
  supplierPayment: { findMany: jest.fn() },
  expense: {
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  },
  expenseCategory: { findMany: jest.fn() },
  customer: { findMany: jest.fn() },
  supplier: { findMany: jest.fn() },
  product: { findMany: jest.fn() },
};

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<ReportsService>(ReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Range resolution
  // ---------------------------------------------------------------------------

  it('400s when from is after to', async () => {
    await expect(
      service.getSalesReport(
        { period: 'custom', from: '2026-10-31', to: '2026-10-01' } as any,
        SHOP_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s when the custom range exceeds 366 days', async () => {
    await expect(
      service.getSalesReport(
        { period: 'custom', from: '2020-01-01', to: '2026-10-01' } as any,
        SHOP_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ---------------------------------------------------------------------------
  // Sales report
  // ---------------------------------------------------------------------------

  it('sales report computes profit and outstanding, scoped to ACTIVE sales in range', async () => {
    prismaStub.sale.findMany.mockResolvedValue([
      {
        id: 's1',
        saleNo: 'S-0001',
        saleDate: new Date('2026-10-05T00:00:00.000Z'),
        subtotal: 150000n,
        discount: 0n,
        totalAmount: 150000n,
        customer: { name: 'Ali' },
        items: [
          { quantity: 1, unitCost: 90000n },
          { quantity: 2, unitCost: 5000n },
        ],
        payments: [{ amount: 100000n }],
        saleReturns: [{ returnAmount: 10000n, refunds: [{ amount: 10000n }] }],
      },
    ]);
    prismaStub.sale.count.mockResolvedValue(1);
    prismaStub.sale.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: { subtotal: 150000n, discount: 0n, totalAmount: 150000n },
    });
    prismaStub.saleItem.findMany.mockResolvedValue([
      { unitCost: 90000n, quantity: 1 },
      { unitCost: 5000n, quantity: 2 },
    ]);
    prismaStub.saleReturn.findMany.mockResolvedValue([
      { returnAmount: 10000n },
    ]);
    prismaStub.refund.findMany.mockResolvedValue([{ amount: 10000n }]);
    prismaStub.payment.findMany.mockResolvedValue([{ amount: 100000n }]);

    const result = await service.getSalesReport(
      {
        period: 'custom',
        from: '2026-10-01',
        to: '2026-10-31',
        page: 1,
        pageSize: 10,
      } as any,
      SHOP_ID,
    );

    expect(prismaStub.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shopId: SHOP_ID,
          status: 'ACTIVE',
        }),
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        saleNo: 'S-0001',
        subtotal: 150000,
        totalAmount: 150000,
        paid: 100000,
        returns: 10000,
        refunds: 10000,
        outstanding: 150000 - 10000 + 10000 - 100000,
        profit: 150000 - (90000 + 2 * 5000),
      }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        count: 1,
        sumSubtotal: 150000,
        sumProfit: 150000 - 100000,
        sumReturns: 10000,
        sumPaid: 100000,
      }),
    );
    expect(result.from).toBe('2026-10-01');
    expect(result.to).toBe('2026-10-31');
  });

  // ---------------------------------------------------------------------------
  // Purchase report
  // ---------------------------------------------------------------------------

  it('purchase report: opening-stock bills create no outstanding', async () => {
    prismaStub.purchase.findMany.mockResolvedValue([
      {
        id: 'p1',
        purchaseNo: 'P-0001',
        purchaseDate: new Date('2026-10-03T00:00:00.000Z'),
        supplier: { name: 'TechLink' },
        supplierInvoiceRef: 'INV-9',
        isOpeningStock: true,
        totalAmount: 200000n,
        supplierPayments: [{ amount: 0n }],
      },
      {
        id: 'p2',
        purchaseNo: 'P-0002',
        purchaseDate: new Date('2026-10-04T00:00:00.000Z'),
        supplier: { name: 'TechLink' },
        supplierInvoiceRef: null,
        isOpeningStock: false,
        totalAmount: 100000n,
        supplierPayments: [{ amount: 30000n }],
      },
    ]);
    prismaStub.purchase.count.mockResolvedValue(2);
    prismaStub.purchase.aggregate
      .mockResolvedValueOnce({
        _count: { _all: 2 },
        _sum: { totalAmount: 300000n },
      })
      .mockResolvedValueOnce({
        _count: { _all: 1 },
        _sum: { totalAmount: 100000n },
      });
    prismaStub.supplierPayment.findMany.mockResolvedValue([{ amount: 30000n }]);

    const result = await service.getPurchaseReport(
      { period: 'custom', from: '2026-10-01', to: '2026-10-31' } as any,
      SHOP_ID,
    );

    expect(result.items[0].outstanding).toBe(0);
    expect(result.items[1].outstanding).toBe(100000 - 30000);
    expect(result.summary).toEqual(
      expect.objectContaining({
        count: 2,
        countReal: 1,
        countOpeningStock: 1,
        sumTotalAmount: 300000,
        sumPaid: 30000,
        sumOutstanding: 70000,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Expense report
  // ---------------------------------------------------------------------------

  it('expense report resolves category names and sorts breakdown by total desc', async () => {
    prismaStub.expense.findMany.mockResolvedValue([
      {
        id: 'e1',
        expenseDate: new Date('2026-10-06T00:00:00.000Z'),
        category: { name: 'Rent' },
        description: 'October rent',
        amount: 50000n,
      },
    ]);
    prismaStub.expense.count.mockResolvedValue(1);
    prismaStub.expense.aggregate.mockResolvedValue({
      _count: { _all: 1 },
      _sum: { amount: 50000n },
    });
    prismaStub.expense.groupBy.mockResolvedValue([
      { categoryId: 'cat-rent', _count: 1, _sum: { amount: 50000n } },
      { categoryId: 'cat-el', _count: 2, _sum: { amount: 90000n } },
    ]);
    prismaStub.expenseCategory.findMany.mockResolvedValue([
      { id: 'cat-rent', name: 'Rent' },
      { id: 'cat-el', name: 'Electricity' },
    ]);

    const result = await service.getExpenseReport(
      { period: 'custom', from: '2026-10-01', to: '2026-10-31' } as any,
      SHOP_ID,
    );

    expect(result.items[0].categoryName).toBe('Rent');
    expect(result.summary.count).toBe(1);
    expect(result.summary.total).toBe(50000);
    expect(result.summary.byCategory).toEqual([
      { categoryName: 'Electricity', count: 2, total: 90000 },
      { categoryName: 'Rent', count: 1, total: 50000 },
    ]);
  });

  // ---------------------------------------------------------------------------
  // Profit report
  // ---------------------------------------------------------------------------

  it('profit report folds per-day rows across the whole range', async () => {
    prismaStub.sale.findMany.mockResolvedValue([
      { saleDate: new Date('2026-10-02T12:00:00.000Z'), totalAmount: 100000n },
    ]);
    prismaStub.saleItem.findMany.mockResolvedValue([
      {
        quantity: 1,
        unitCost: 60000n,
        sale: { saleDate: new Date('2026-10-02T12:00:00.000Z') },
      },
    ]);
    prismaStub.expense.findMany.mockResolvedValue([
      { expenseDate: new Date('2026-10-02T00:00:00.000Z'), amount: 10000n },
    ]);
    prismaStub.saleReturn.findMany.mockResolvedValue([
      { returnDate: new Date('2026-10-01T00:00:00.000Z'), returnAmount: 5000n },
    ]);

    const result = await service.getProfitReport(
      { period: 'custom', from: '2026-10-01', to: '2026-10-03' } as any,
      SHOP_ID,
    );

    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toEqual({
      date: '2026-10-01',
      grossSales: 0,
      cogs: 0,
      returns: 5000,
      expenses: 0,
      profit: -5000,
    });
    expect(result.items[1].profit).toBe(100000 - 60000 - 0 - 10000);
    expect(result.items[2].profit).toBe(0);
    expect(result.summary).toEqual(
      expect.objectContaining({
        grossSales: 100000,
        cogs: 60000,
        grossProfit: 40000,
        returns: 5000,
        expenses: 10000,
        netProfit: 25000,
        salesCount: 1,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Customer report (snapshot)
  // ---------------------------------------------------------------------------

  it('customer report derives outstanding + overdue and ignores the date range', async () => {
    const today = new Date(`${businessToday()}T00:00:00.000Z`);
    const overdueDate = new Date(today.getTime() - 2 * 86400000);
    prismaStub.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Ali',
        phone: null,
        openingBalance: 5000n,
        sales: [
          {
            totalAmount: 100000n,
            saleDate: new Date('2026-09-01T12:00:00.000Z'),
            dueDate: overdueDate,
            payments: [{ amount: 40000n }],
            saleReturns: [{ returnAmount: 0n, refunds: [] }],
          },
        ],
      },
    ]);

    const result = await service.getCustomerReport(
      { period: 'custom', from: '2026-01-01', to: '2026-01-31' } as any,
      SHOP_ID,
    );

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        name: 'Ali',
        openingBalance: 5000,
        bought: 100000,
        paid: 40000,
        returns: 0,
        refunds: 0,
        outstanding: 65000,
        overdue: 100000 - 40000,
      }),
    );
    // snapshot: the range means nothing, the page reports "as of today"
    expect(result.from).toBe(businessToday());
    expect(result.to).toBe(businessToday());
  });

  it('customer report only counts a past-due part of a sale once its dueDate passed', async () => {
    const today = new Date(`${businessToday()}T00:00:00.000Z`);
    prismaStub.customer.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Ali',
        phone: null,
        openingBalance: 0n,
        sales: [
          {
            totalAmount: 50000n,
            saleDate: new Date(),
            dueDate: new Date(today.getTime() + 10 * 86400000),
            payments: [],
            saleReturns: [],
          },
        ],
      },
    ]);

    const result = await service.getCustomerReport({}, SHOP_ID);

    expect(result.items[0].overdue).toBe(0);
    expect(result.items[0].outstanding).toBe(50000);
  });

  // ---------------------------------------------------------------------------
  // Supplier report (snapshot)
  // ---------------------------------------------------------------------------

  it('supplier report derives payable and excludes opening-stock purchases', async () => {
    prismaStub.supplier.findMany.mockResolvedValue([
      {
        id: 'sup1',
        name: 'TechLink',
        phone: null,
        openingBalance: 20000n,
        purchases: [
          {
            totalAmount: 100000n,
            purchaseDate: new Date('2026-09-01T00:00:00.000Z'),
          },
        ],
        supplierPayments: [{ amount: 30000n }],
      },
    ]);

    const result = await service.getSupplierReport({}, SHOP_ID);

    expect(prismaStub.supplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          purchases: {
            where: expect.objectContaining({ isOpeningStock: false }),
            select: expect.anything(),
          },
        }),
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        name: 'TechLink',
        openingBalance: 20000,
        bought: 100000,
        paid: 30000,
        payable: 90000,
      }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({ count: 1, totalPayable: 90000 }),
    );
  });

  // ---------------------------------------------------------------------------
  // Inventory report (snapshot)
  // ---------------------------------------------------------------------------

  it('inventory report: serialized counts IN_STOCK units, quantity uses the stock level', async () => {
    prismaStub.product.findMany.mockResolvedValue([
      {
        id: 'ph',
        name: 'iPhone 13',
        sku: 'IP13',
        barcode: null,
        trackingType: 'SERIALIZED',
        lowStockThreshold: 2,
        category: { name: 'Phones' },
        brand: { name: 'Apple' },
        stockLevel: null,
        inventoryUnits: [
          { imei1: '111', unitCost: 250000n },
          { imei1: '222', unitCost: 250000n },
        ],
      },
      {
        id: 'qb',
        name: 'Charger',
        sku: 'CHG',
        barcode: null,
        trackingType: 'QUANTITY',
        lowStockThreshold: 5,
        category: { name: 'Accessories' },
        brand: { name: 'Anker' },
        stockLevel: { quantityOnHand: 3, avgUnitCost: 1500n },
        inventoryUnits: [],
      },
    ]);

    const result = await service.getInventoryReport({}, SHOP_ID);

    const phone = result.items.find((r) => r.id === 'ph')!;
    const charger = result.items.find((r) => r.id === 'qb')!;
    expect(phone).toEqual(
      expect.objectContaining({
        inStock: 2,
        stockValue: 500000,
        lowStock: true,
        imeis: ['111', '222'],
      }),
    );
    expect(charger).toEqual(
      expect.objectContaining({
        inStock: 3,
        stockValue: 3 * 1500,
        lowStock: true,
        imeis: [],
      }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        countProducts: 2,
        countLowStock: 2,
        countUnitsInStock: 5,
        stockValueTotal: 500000 + 4500,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Best-sellers report
  // ---------------------------------------------------------------------------

  it('best-sellers report resolves names and sorts by quantity sold desc', async () => {
    prismaStub.saleItem.groupBy.mockResolvedValue([
      { productId: 'p2', _sum: { quantity: 40n, total: 100000n } },
      { productId: 'p1', _sum: { quantity: 5n, total: 250000n } },
    ]);
    prismaStub.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'iPhone 13',
        category: { name: 'Phones' },
        brand: { name: 'Apple' },
      },
      {
        id: 'p2',
        name: 'Charger',
        category: { name: 'Accessories' },
        brand: { name: 'Anker' },
      },
    ]);

    const result = await service.getBestSellersReport(
      { period: 'today' } as any,
      SHOP_ID,
    );

    expect(result.items.map((r) => r.productName)).toEqual([
      'Charger',
      'iPhone 13',
    ]);
    expect(result.items[0]).toEqual(
      expect.objectContaining({ quantitySold: 40, revenue: 100000 }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        countProducts: 2,
        totalQuantitySold: 45,
        totalRevenue: 350000,
      }),
    );
  });
});

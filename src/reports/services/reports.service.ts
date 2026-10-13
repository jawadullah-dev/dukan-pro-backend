import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  RecordStatus,
  TrackingType,
  UnitStatus,
} from '../../generated/prisma/enums.js';
import {
  dateColumnRange,
  periodRange,
  shiftDays,
  businessToday,
} from '../../helpers/date.helper.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { formatBusinessDate } from '../../helpers/csv.helper.js';
import {
  invalidReportRange,
  reportPeriodTooLong,
} from '../../errors/error.builder.js';
import { ReportQueryFilterDto } from '../dto/report-query.filter.js';
import { ReportPageResponseDTO } from '../dto/report-page-response.dto.js';
import {
  SaleReportRowDTO,
  SalesReportSummaryDTO,
} from '../dto/sales-report.dto.js';
import {
  PurchaseReportRowDTO,
  PurchaseReportSummaryDTO,
} from '../dto/purchase-report.dto.js';
import {
  ExpenseReportRowDTO,
  ExpenseReportSummaryDTO,
  ExpenseCategoryBreakdownDTO,
} from '../dto/expense-report.dto.js';
import {
  ProfitReportSummaryDTO,
  ProfitDayRowDTO,
} from '../dto/profit-report.dto.js';
import {
  CustomerReportRowDTO,
  CustomerReportSummaryDTO,
} from '../dto/customer-report.dto.js';
import {
  SupplierReportRowDTO,
  SupplierReportSummaryDTO,
} from '../dto/supplier-report.dto.js';
import {
  InventoryReportRowDTO,
  InventoryReportSummaryDTO,
} from '../dto/inventory-report.dto.js';
import {
  BestSellerReportRowDTO,
  BestSellerReportSummaryDTO,
} from '../dto/best-seller-report.dto.js';

const ACTIVE = RecordStatus.ACTIVE;

/**
 * WF18 — Detailed Reports and Export.
 *
 * Eight read-only endpoints, one per report. Every query is scoped to
 * `shopId` and (for the five transactional reports) to the chosen business-day
 * range, and CANCELLED rows are excluded everywhere — the same "history is
 * added, never counted twice" rule the rest of the product follows.
 *
 * Periods: today / week (Monday start) / month / custom range, resolved in
 * Asia/Karachi by `periodRange`. The three snapshot reports (customers,
 * suppliers, inventory) ignore the date range on purpose — outstanding,
 * payable and stock are cumulative facts, not period sums.
 *
 * Reports never mix revenue, money received, Udhar and cash (WF18 rule):
 * sales revenue = ACTIVE sales; payments are only ever shown as "paid/cash in",
 * Udhar outstanding is derived, and cash stays in the cash module. No
 * transactions here — pure reads, like the dashboard.
 *
 * CSV export is a `format=csv` flag on any report; the controller maps the
 * page to a download. PDF is a later ticket.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Sales report
  // ---------------------------------------------------------------------------

  async getSalesReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<ReportPageResponseDTO<SaleReportRowDTO, SalesReportSummaryDTO>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const range = this.resolveRange(query);
    const where = {
      shopId,
      status: ACTIVE,
      saleDate: { gte: range.start, lt: range.end },
    };
    const search = this.searchOr(query, ['saleNo', 'customerName']);

    const [rows, total, summary] = await Promise.all([
      this.prisma.sale.findMany({
        where: { ...where, ...search },
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: this.orderBy('saleDate', query, [
          'saleDate',
          'saleNo',
          'totalAmount',
        ]),
        include: {
          customer: { select: { name: true } },
          items: { select: { quantity: true, unitCost: true } },
          payments: { where: { status: ACTIVE }, select: { amount: true } },
          saleReturns: {
            where: { status: ACTIVE },
            select: {
              returnAmount: true,
              refunds: { select: { amount: true } },
            },
          },
        },
      }),
      this.prisma.sale.count({ where: { ...where, ...search } }),
      this.salesSummary(shopId, range),
    ]);

    const items: SaleReportRowDTO[] = rows.map((sale) => {
      const cogs = sale.items.reduce(
        (sum, item) => sum + Number(item.unitCost) * item.quantity,
        0,
      );
      const subtotal = Number(sale.subtotal);
      const paid = sale.payments.reduce((s, p) => s + Number(p.amount), 0);
      const returns = sale.saleReturns.reduce(
        (s, r) => s + Number(r.returnAmount),
        0,
      );
      const refunds = sale.saleReturns.reduce(
        (s, r) => s + r.refunds.reduce((x, f) => x + Number(f.amount), 0),
        0,
      );
      return {
        id: sale.id,
        saleNo: sale.saleNo,
        saleDate: formatBusinessDate(sale.saleDate),
        customerName: sale.customer?.name ?? null,
        subtotal,
        discount: Number(sale.discount),
        totalAmount: Number(sale.totalAmount),
        paid,
        returns,
        refunds,
        outstanding: Number(sale.totalAmount) - returns + refunds - paid,
        profit: subtotal - cogs,
      };
    });

    return new ReportPageResponseDTO(
      items,
      summary,
      total,
      page,
      pageSize,
      range.from,
      range.to,
    );
  }

  private async salesSummary(
    shopId: string,
    range: { start: Date; end: Date },
  ): Promise<SalesReportSummaryDTO> {
    const saleWhere = {
      shopId,
      status: ACTIVE,
      saleDate: { gte: range.start, lt: range.end },
    };
    const [agg, saleItems, returns, payments] = await Promise.all([
      this.prisma.sale.aggregate({
        where: saleWhere,
        _count: { _all: true },
        _sum: { subtotal: true, discount: true, totalAmount: true },
      }),
      this.prisma.saleItem.findMany({
        where: { shopId, sale: saleWhere },
        select: { unitCost: true, quantity: true },
      }),
      this.prisma.saleReturn.findMany({
        where: { shopId, status: ACTIVE, sale: saleWhere },
        select: { returnAmount: true },
      }),
      this.prisma.payment.findMany({
        where: { shopId, status: ACTIVE, sale: saleWhere },
        select: { amount: true },
      }),
    ]);

    const cogs = saleItems.reduce(
      (sum, item) => sum + Number(item.unitCost) * item.quantity,
      0,
    );
    const sumSubtotal = Number(agg._sum.subtotal ?? 0n);
    return {
      count: agg._count._all,
      sumSubtotal,
      sumDiscount: Number(agg._sum.discount ?? 0n),
      sumTotalAmount: Number(agg._sum.totalAmount ?? 0n),
      sumProfit: sumSubtotal - cogs,
      sumReturns: returns.reduce((s, r) => s + Number(r.returnAmount), 0),
      sumPaid: payments.reduce((s, p) => s + Number(p.amount), 0),
    };
  }

  // ---------------------------------------------------------------------------
  // Purchase report
  // ---------------------------------------------------------------------------

  async getPurchaseReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<
    ReportPageResponseDTO<PurchaseReportRowDTO, PurchaseReportSummaryDTO>
  > {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const range = this.resolveRange(query);
    const dateRange = dateColumnRange(range.from, range.to);
    const where = { shopId, status: ACTIVE, purchaseDate: dateRange };
    const search = this.searchOr(query, [
      'purchaseNo',
      'supplierName',
      'invoiceRef',
    ]);

    const [rows, total, summary] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { ...where, ...search },
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: this.orderBy('purchaseDate', query, [
          'purchaseDate',
          'purchaseNo',
          'totalAmount',
        ]),
        include: {
          supplier: { select: { name: true } },
          supplierPayments: {
            where: { status: ACTIVE },
            select: { amount: true },
          },
        },
      }),
      this.prisma.purchase.count({ where: { ...where, ...search } }),
      this.purchaseSummary(shopId, range),
    ]);

    const items: PurchaseReportRowDTO[] = rows.map((purchase) => {
      const paid = purchase.supplierPayments.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );
      return {
        id: purchase.id,
        purchaseNo: purchase.purchaseNo,
        purchaseDate: purchase.purchaseDate.toISOString().slice(0, 10),
        supplierName: purchase.supplier.name,
        supplierInvoiceRef: purchase.supplierInvoiceRef,
        isOpeningStock: purchase.isOpeningStock,
        totalAmount: Number(purchase.totalAmount),
        paid,
        outstanding: purchase.isOpeningStock
          ? 0
          : Number(purchase.totalAmount) - paid,
      };
    });

    return new ReportPageResponseDTO(
      items,
      summary,
      total,
      page,
      pageSize,
      range.from,
      range.to,
    );
  }

  private async purchaseSummary(
    shopId: string,
    range: { from: string; to: string },
  ): Promise<PurchaseReportSummaryDTO> {
    const dateRange = dateColumnRange(range.from, range.to);
    const where = { shopId, status: ACTIVE, purchaseDate: dateRange };
    const [agg, realAgg, supplierPayments] = await Promise.all([
      this.prisma.purchase.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchase.aggregate({
        where: { ...where, isOpeningStock: false },
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.supplierPayment.findMany({
        where: { shopId, status: ACTIVE, purchase: where },
        select: { amount: true },
      }),
    ]);

    const sumPaid = supplierPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );
    const sumReal = Number(realAgg._sum.totalAmount ?? 0n);
    return {
      count: agg._count._all,
      countReal: realAgg._count._all,
      countOpeningStock: agg._count._all - realAgg._count._all,
      sumTotalAmount: Number(agg._sum.totalAmount ?? 0n),
      sumPaid,
      sumOutstanding: sumReal - sumPaid,
    };
  }

  // ---------------------------------------------------------------------------
  // Expense report
  // ---------------------------------------------------------------------------

  async getExpenseReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<
    ReportPageResponseDTO<ExpenseReportRowDTO, ExpenseReportSummaryDTO>
  > {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const range = this.resolveRange(query);
    const dateRange = dateColumnRange(range.from, range.to);
    const where = { shopId, status: ACTIVE, expenseDate: dateRange };
    const search = this.searchOr(query, ['description', 'categoryName']);

    const [rows, total, summary] = await Promise.all([
      this.prisma.expense.findMany({
        where: { ...where, ...search },
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: this.orderBy('expenseDate', query, [
          'expenseDate',
          'amount',
          'createdAt',
        ]),
        include: { category: { select: { name: true } } },
      }),
      this.prisma.expense.count({ where: { ...where, ...search } }),
      this.expenseSummary(shopId, where),
    ]);

    const items: ExpenseReportRowDTO[] = rows.map((expense) => ({
      id: expense.id,
      expenseDate: expense.expenseDate.toISOString().slice(0, 10),
      categoryName: expense.category.name,
      description: expense.description,
      amount: Number(expense.amount),
    }));

    return new ReportPageResponseDTO(
      items,
      summary,
      total,
      page,
      pageSize,
      range.from,
      range.to,
    );
  }

  private async expenseSummary(
    shopId: string,
    where: object,
  ): Promise<ExpenseReportSummaryDTO> {
    const [total, byCategory] = await Promise.all([
      this.prisma.expense.aggregate({
        where,
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.expense.groupBy({
        by: ['categoryId'],
        where,
        _count: true,
        _sum: { amount: true },
      }),
    ]);

    const names = await this.prisma.expenseCategory.findMany({
      where: { shopId, id: { in: byCategory.map((r) => r.categoryId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((n) => [n.id, n.name]));

    const breakdown: ExpenseCategoryBreakdownDTO[] = byCategory
      .map((row) => ({
        categoryName: nameById.get(row.categoryId) ?? row.categoryId,
        count: row._count,
        total: Number(row._sum.amount ?? 0n),
      }))
      .sort((a, b) => b.total - a.total);

    return {
      count: total._count._all,
      total: Number(total._sum.amount ?? 0n),
      byCategory: breakdown,
    };
  }

  // ---------------------------------------------------------------------------
  // Profit report
  // ---------------------------------------------------------------------------

  async getProfitReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<ReportPageResponseDTO<ProfitDayRowDTO, ProfitReportSummaryDTO>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const range = this.resolveRange(query);
    const saleWhere = {
      shopId,
      status: ACTIVE,
      saleDate: { gte: range.start, lt: range.end },
    };

    const [sales, saleItems, expenses, returns] = await Promise.all([
      this.prisma.sale.findMany({
        where: saleWhere,
        select: { saleDate: true, totalAmount: true },
      }),
      this.prisma.saleItem.findMany({
        where: { shopId, sale: saleWhere },
        select: {
          quantity: true,
          unitCost: true,
          sale: { select: { saleDate: true } },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          shopId,
          status: ACTIVE,
          expenseDate: dateColumnRange(range.from, range.to),
        },
        select: { expenseDate: true, amount: true },
      }),
      this.prisma.saleReturn.findMany({
        where: {
          shopId,
          status: ACTIVE,
          returnDate: { gte: range.start, lt: range.end },
        },
        select: { returnDate: true, returnAmount: true },
      }),
    ]);

    const gross = new Map<string, number>();
    const cogs = new Map<string, number>();
    const expenseByDay = new Map<string, number>();
    const returnByDay = new Map<string, number>();

    for (const sale of sales) {
      const day = formatBusinessDate(sale.saleDate);
      gross.set(day, (gross.get(day) ?? 0) + Number(sale.totalAmount));
    }
    for (const item of saleItems) {
      const day = formatBusinessDate(item.sale.saleDate);
      cogs.set(
        day,
        (cogs.get(day) ?? 0) + Number(item.unitCost) * item.quantity,
      );
    }
    for (const expense of expenses) {
      const day = expense.expenseDate.toISOString().slice(0, 10);
      expenseByDay.set(
        day,
        (expenseByDay.get(day) ?? 0) + Number(expense.amount),
      );
    }
    for (const r of returns) {
      const day = formatBusinessDate(r.returnDate);
      returnByDay.set(
        day,
        (returnByDay.get(day) ?? 0) + Number(r.returnAmount),
      );
    }

    const rows: ProfitDayRowDTO[] = [];
    let day = range.from;
    let tGross = 0;
    let tCogs = 0;
    let tReturns = 0;
    let tExpenses = 0;
    while (day <= range.to) {
      const d = day;
      const g = gross.get(d) ?? 0;
      const c = cogs.get(d) ?? 0;
      const ret = returnByDay.get(d) ?? 0;
      const exp = expenseByDay.get(d) ?? 0;
      tGross += g;
      tCogs += c;
      tReturns += ret;
      tExpenses += exp;
      rows.push({
        date: d,
        grossSales: g,
        cogs: c,
        returns: ret,
        expenses: exp,
        profit: g - c - ret - exp,
      });
      day = shiftDays(day, 1);
    }

    const startIndex = (page - 1) * pageSize;
    const summary: ProfitReportSummaryDTO = {
      grossSales: tGross,
      cogs: tCogs,
      grossProfit: tGross - tCogs,
      returns: tReturns,
      expenses: tExpenses,
      netProfit: tGross - tCogs - tReturns - tExpenses,
      salesCount: sales.length,
    };

    return new ReportPageResponseDTO(
      // oldest first; profit rows are a chart series, not a searchable list
      rows.slice(startIndex, startIndex + pageSize),
      summary,
      rows.length,
      page,
      pageSize,
      range.from,
      range.to,
    );
  }

  // ---------------------------------------------------------------------------
  // Customer report (snapshot — period ignored)
  // ---------------------------------------------------------------------------

  async getCustomerReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<
    ReportPageResponseDTO<CustomerReportRowDTO, CustomerReportSummaryDTO>
  > {
    const customers = await this.prisma.customer.findMany({
      where: {
        shopId,
        isActive: true,
        ...this.searchOr(query, ['name', 'phone']),
      },
      include: {
        sales: {
          where: { status: ACTIVE },
          select: {
            totalAmount: true,
            saleDate: true,
            dueDate: true,
            payments: {
              where: { status: ACTIVE },
              select: { amount: true },
            },
            saleReturns: {
              where: { status: ACTIVE },
              select: {
                returnAmount: true,
                refunds: { select: { amount: true } },
              },
            },
          },
        },
      },
    });

    const today = new Date(`${businessToday()}T00:00:00.000Z`);
    const rows: CustomerReportRowDTO[] = customers.map((customer) => {
      let bought = 0;
      let paid = 0;
      let returns = 0;
      let refunds = 0;
      let overdue = 0;
      let lastSaleDate: string | null = null;
      for (const sale of customer.sales) {
        const salePaid = sale.payments.reduce(
          (s, p) => s + Number(p.amount),
          0,
        );
        const saleReturns = sale.saleReturns.reduce(
          (s, r) => s + Number(r.returnAmount),
          0,
        );
        const saleRefunds = sale.saleReturns.reduce(
          (s, r) => s + r.refunds.reduce((x, f) => x + Number(f.amount), 0),
          0,
        );
        bought += Number(sale.totalAmount);
        paid += salePaid;
        returns += saleReturns;
        refunds += saleRefunds;
        const date = formatBusinessDate(sale.saleDate);
        if (!lastSaleDate || date > lastSaleDate) lastSaleDate = date;
        if (sale.dueDate && sale.dueDate < today) {
          const remaining = Number(sale.totalAmount) - salePaid - saleReturns;
          if (remaining > 0) overdue += remaining;
        }
      }
      const opening = Number(customer.openingBalance);
      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        openingBalance: opening,
        bought,
        paid,
        returns,
        refunds,
        outstanding: opening + bought - paid - returns + refunds,
        overdue,
        lastSaleDate,
      };
    });

    return this.pageSnapshot(
      rows,
      query,
      'outstanding',
      ['name', 'outstanding', 'lastSaleDate'],
      {
        count: rows.length,
        totalOutstanding: rows.reduce((s, r) => s + r.outstanding, 0),
        totalOverdue: rows.reduce((s, r) => s + r.overdue, 0),
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Supplier report (snapshot — period ignored)
  // ---------------------------------------------------------------------------

  async getSupplierReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<
    ReportPageResponseDTO<SupplierReportRowDTO, SupplierReportSummaryDTO>
  > {
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        shopId,
        isActive: true,
        ...this.searchOr(query, ['name', 'phone']),
      },
      include: {
        purchases: {
          where: { status: ACTIVE, isOpeningStock: false },
          select: { totalAmount: true, purchaseDate: true },
        },
        supplierPayments: {
          where: { status: ACTIVE },
          select: { amount: true },
        },
      },
    });

    const rows: SupplierReportRowDTO[] = suppliers.map((supplier) => {
      let bought = 0;
      let lastPurchaseDate: string | null = null;
      for (const purchase of supplier.purchases) {
        bought += Number(purchase.totalAmount);
        const date = purchase.purchaseDate.toISOString().slice(0, 10);
        if (!lastPurchaseDate || date > lastPurchaseDate) {
          lastPurchaseDate = date;
        }
      }
      const paid = supplier.supplierPayments.reduce(
        (s, p) => s + Number(p.amount),
        0,
      );
      const opening = Number(supplier.openingBalance);
      return {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        openingBalance: opening,
        bought,
        paid,
        payable: opening + bought - paid,
        lastPurchaseDate,
      };
    });

    return this.pageSnapshot(
      rows,
      query,
      'payable',
      ['name', 'payable', 'lastPurchaseDate'],
      {
        count: rows.length,
        totalPayable: rows.reduce((s, r) => s + r.payable, 0),
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Inventory report (snapshot — period ignored)
  // ---------------------------------------------------------------------------

  async getInventoryReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<
    ReportPageResponseDTO<InventoryReportRowDTO, InventoryReportSummaryDTO>
  > {
    const products = await this.prisma.product.findMany({
      where: {
        shopId,
        isActive: true,
        ...this.searchOr(query, ['name', 'sku', 'barcode']),
      },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        stockLevel: { select: { quantityOnHand: true, avgUnitCost: true } },
        inventoryUnits: {
          where: { status: UnitStatus.IN_STOCK },
          select: { imei1: true, unitCost: true },
        },
      },
    });

    const rows: InventoryReportRowDTO[] = products.map((product) => {
      const serialized = product.trackingType === TrackingType.SERIALIZED;
      const inStock = serialized
        ? product.inventoryUnits.length
        : (product.stockLevel?.quantityOnHand ?? 0);
      const stockValue = serialized
        ? product.inventoryUnits.reduce((s, u) => s + Number(u.unitCost), 0)
        : inStock * Number(product.stockLevel?.avgUnitCost ?? 0n);
      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        categoryName: product.category.name,
        brandName: product.brand.name,
        trackingType: product.trackingType,
        inStock,
        stockValue,
        lowStock: inStock <= product.lowStockThreshold,
        imeis: serialized ? product.inventoryUnits.map((u) => u.imei1) : [],
      };
    });

    return this.pageSnapshot(
      rows,
      query,
      'name',
      ['name', 'inStock', 'stockValue'],
      {
        countProducts: rows.length,
        countLowStock: rows.filter((r) => r.lowStock).length,
        countUnitsInStock: rows.reduce((s, r) => s + r.inStock, 0),
        stockValueTotal: rows.reduce((s, r) => s + r.stockValue, 0),
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Best-selling products report
  // ---------------------------------------------------------------------------

  async getBestSellersReport(
    query: ReportQueryFilterDto,
    shopId: string,
  ): Promise<
    ReportPageResponseDTO<BestSellerReportRowDTO, BestSellerReportSummaryDTO>
  > {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const range = this.resolveRange(query);
    const saleWhere = {
      shopId,
      status: ACTIVE,
      saleDate: { gte: range.start, lt: range.end },
    };
    const search = this.searchOr(query, ['productName']);

    const grouped = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { shopId, sale: saleWhere, ...search },
      _sum: { quantity: true, total: true },
    });

    const names = await this.prisma.product.findMany({
      where: { shopId, id: { in: grouped.map((g) => g.productId) } },
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
    });
    const byId = new Map(names.map((p) => [p.id, p]));

    const all: BestSellerReportRowDTO[] = grouped
      .map((g) => {
        const product = byId.get(g.productId);
        return {
          productId: g.productId,
          productName: product?.name ?? g.productId,
          categoryName: product?.category.name ?? '—',
          brandName: product?.brand.name ?? '—',
          quantitySold: Number(g._sum.quantity ?? 0n),
          revenue: Number(g._sum.total ?? 0n),
        };
      })
      .sort((a, b) => b.quantitySold - a.quantitySold);

    const startIndex = (page - 1) * pageSize;
    const summary: BestSellerReportSummaryDTO = {
      countProducts: all.length,
      totalQuantitySold: all.reduce((s, r) => s + r.quantitySold, 0),
      totalRevenue: all.reduce((s, r) => s + r.revenue, 0),
    };

    return new ReportPageResponseDTO(
      all.slice(startIndex, startIndex + pageSize),
      summary,
      all.length,
      page,
      pageSize,
      range.from,
      range.to,
    );
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** Resolve today/week/month/custom to an applied range or throw a clean 400. */
  private resolveRange(query: ReportQueryFilterDto): {
    start: Date;
    end: Date;
    from: string;
    to: string;
  } {
    const range = periodRange(query.period, query.from, query.to);
    if (range.from > range.to) {
      throw new BadRequestException(invalidReportRange(range.from, range.to));
    }
    const days = (range.end.getTime() - range.start.getTime()) / 86_400_000;
    if (days > 366) {
      throw new BadRequestException(reportPeriodTooLong(days));
    }
    return range;
  }

  /**
   * Free-text search mapped per report. `search` matches a set of containing
   * fields with a leading name (e.g. customerName) resolved to a nested
   * relation; everything else is a literal column.
   */
  private searchOr(
    query: ReportQueryFilterDto,
    fields: string[],
  ): Record<string, unknown> {
    const term = query.search?.trim();
    if (!term) return {};
    const contains = { contains: term, mode: 'insensitive' as const };
    const or = fields.map((field) => {
      if (field === 'customerName') {
        return { customer: { name: contains } };
      }
      if (field === 'supplierName') {
        return { supplier: { name: contains } };
      }
      if (field === 'categoryName') {
        return { category: { name: contains } };
      }
      if (field === 'productName') {
        return { product: { name: contains } };
      }
      return { [field]: contains };
    });
    return { OR: or };
  }

  /** Whitelisted column sort, `sortBy` ignored unless it is in `allowed`. */
  private orderBy(
    fallback: string,
    query: ReportQueryFilterDto,
    allowed: string[],
  ): Record<string, 'asc' | 'desc'> {
    const column = allowed.includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : fallback;
    return { [column]: query.sortOrder ?? 'desc' };
  }

  /** Client-side paging + default sort for the JS-folded snapshot reports. */
  private pageSnapshot<T, S>(
    rows: T[],
    query: ReportQueryFilterDto,
    fallback: string,
    allowed: string[],
    summary: S,
  ): ReportPageResponseDTO<T, S> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const column = allowed.includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : fallback;
    const order = query.sortOrder ?? 'desc';
    const key = column as keyof T;
    const sorted = [...rows].sort((a, b) => {
      const av = a[key] as unknown as string | number | null;
      const bv = b[key] as unknown as string | number | null;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
      return order === 'asc' ? cmp : -cmp;
    });
    const startIndex = (page - 1) * pageSize;
    const today = businessToday();
    return new ReportPageResponseDTO(
      sorted.slice(startIndex, startIndex + pageSize),
      summary,
      rows.length,
      page,
      pageSize,
      today,
      today,
    );
  }
}

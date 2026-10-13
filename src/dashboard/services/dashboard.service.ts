import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  CashDirection,
  RecordStatus,
  TrackingType,
  UnitStatus,
} from '../../generated/prisma/enums.js';
import { businessDayRange, businessToday } from '../../helpers/date.helper.js';
import { DashboardQueryFilterDto } from '../dto/dashboard-query.filter.js';
import { DashboardDto } from '../dto/response-dashboard.dto.js';

/**
 * WF14 — the seven dashboard numbers.
 *
 * Pure reads: no transaction, no writes. Every query filters `shopId` first
 * and excludes CANCELLED rows (WF12 rule). The numbers are deliberately
 * independent — revenue ≠ cash ≠ Udhar — and each is derived here, never
 * stored. Reads run in parallel; a number may straddle another request's
 * commit by a few milliseconds, which is acceptable for a summary screen.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(
    query: DashboardQueryFilterDto,
    shopId: string,
  ): Promise<DashboardDto> {
    const date = businessToday();
    const { start, end } = businessDayRange(date);
    // `date` columns hold the owner's business date at UTC midnight.
    const businessDate = new Date(`${date}T00:00:00.000Z`);

    const [
      todaySalesAgg,
      todaySaleItems,
      todayExpenseAgg,
      customerOpenings,
      shopSales,
      shopPayments,
      shopReturns,
      shopRefunds,
      supplierOpenings,
      shopPurchases,
      shopSupplierPayments,
      cashByDirection,
      quantityProducts,
      serializedProducts,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: {
          shopId,
          status: RecordStatus.ACTIVE,
          saleDate: { gte: start, lte: end },
        },
        _sum: { totalAmount: true },
      }),
      // unitCost × quantity per line; Prisma cannot multiply inside aggregate().
      this.prisma.saleItem.findMany({
        where: {
          shopId,
          sale: {
            status: RecordStatus.ACTIVE,
            saleDate: { gte: start, lte: end },
          },
        },
        select: { unitCost: true, quantity: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          shopId,
          status: RecordStatus.ACTIVE,
          expenseDate: { equals: businessDate },
        },
        _sum: { amount: true },
      }),
      this.prisma.customer.aggregate({
        where: { shopId },
        _sum: { openingBalance: true },
      }),
      this.prisma.sale.aggregate({
        where: { shopId, status: RecordStatus.ACTIVE },
        _sum: { totalAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: { shopId, status: RecordStatus.ACTIVE },
        _sum: { amount: true },
      }),
      this.prisma.saleReturn.aggregate({
        where: { shopId, status: RecordStatus.ACTIVE },
        _sum: { returnAmount: true },
      }),
      // Refunds carry no status of their own — only those against an ACTIVE
      // return count (WF15).
      this.prisma.refund.aggregate({
        where: { shopId, saleReturn: { status: RecordStatus.ACTIVE } },
        _sum: { amount: true },
      }),
      this.prisma.supplier.aggregate({
        where: { shopId },
        _sum: { openingBalance: true },
      }),
      this.prisma.purchase.aggregate({
        where: {
          shopId,
          status: RecordStatus.ACTIVE,
          isOpeningStock: false,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.supplierPayment.aggregate({
        where: { shopId, status: RecordStatus.ACTIVE },
        _sum: { amount: true },
      }),
      this.prisma.cashMovement.groupBy({
        by: ['direction'],
        where: { shopId },
        _sum: { amount: true },
      }),
      this.prisma.product.findMany({
        where: {
          shopId,
          isActive: true,
          trackingType: TrackingType.QUANTITY,
        },
        select: {
          lowStockThreshold: true,
          stockLevel: { select: { quantityOnHand: true } },
        },
      }),
      this.prisma.product.findMany({
        where: {
          shopId,
          isActive: true,
          trackingType: TrackingType.SERIALIZED,
        },
        select: {
          lowStockThreshold: true,
          _count: {
            select: {
              inventoryUnits: { where: { status: UnitStatus.IN_STOCK } },
            },
          },
        },
      }),
    ]);

    const todaySales = Number(todaySalesAgg._sum.totalAmount ?? 0n);
    const cogs = todaySaleItems.reduce(
      (sum, item) => sum + Number(item.unitCost) * item.quantity,
      0,
    );
    const todayExpenses = Number(todayExpenseAgg._sum.amount ?? 0n);

    // Walk-in cash sales cancel out: their ACTIVE sale (+) has an ACTIVE
    // payment row with customerId null (−) for the same amount, so the
    // shop-wide sums equal the per-customer outstanding from WF10.
    // WF15 joined the derivation: returns hand goods back (Udhar falls),
    // refunds hand cash back (Udhar rises).
    const customerUdhar =
      Number(customerOpenings._sum.openingBalance ?? 0n) +
      Number(shopSales._sum.totalAmount ?? 0n) -
      Number(shopPayments._sum.amount ?? 0n) -
      Number(shopReturns._sum.returnAmount ?? 0n) +
      Number(shopRefunds._sum.amount ?? 0n);

    const supplierPayable =
      Number(supplierOpenings._sum.openingBalance ?? 0n) +
      Number(shopPurchases._sum.totalAmount ?? 0n) -
      Number(shopSupplierPayments._sum.amount ?? 0n);

    const lowStockProducts =
      quantityProducts.filter(
        (p) => (p.stockLevel?.quantityOnHand ?? 0) <= p.lowStockThreshold,
      ).length +
      serializedProducts.filter(
        (p) => p._count.inventoryUnits <= p.lowStockThreshold,
      ).length;

    let cashIn = 0n;
    let cashOut = 0n;
    for (const row of cashByDirection) {
      const amount = row._sum.amount ?? 0n;
      if (row.direction === CashDirection.IN) cashIn += amount;
      else cashOut += amount;
    }

    const day = `from=${date}&to=${date}`;
    return {
      period: query.period ?? 'today',
      date,
      todaySales,
      todayNetProfit: todaySales - cogs - todayExpenses,
      customerUdhar,
      supplierPayable,
      todayExpenses,
      lowStockProducts,
      cashPosition: Number(cashIn - cashOut),
      links: {
        todaySales: `/sales?${day}`,
        todayNetProfit: `/sales?${day}`,
        customerUdhar: '/customers',
        supplierPayable: '/suppliers',
        todayExpenses: `/expenses?${day}`,
        lowStockProducts: '/products',
        cashPosition: '/cash/movements',
      },
    };
  }
}

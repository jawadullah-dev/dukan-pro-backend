import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CashDirection,
  CashMovementType,
  InventoryMovementType,
  RecordStatus,
  ReferenceType,
  UnitStatus,
} from '../../generated/prisma/enums.js';
import { CreateSaleDto } from '../dto/create-sale.dto.js';
import { CancelSaleDto } from '../dto/cancel-sale.dto.js';
import { SaleQueryFilterDto } from '../dto/sale-query.filter.js';
import {
  ResponsePaymentDto,
  ResponseSaleDto,
  ResponseSaleItemDto,
} from '../dto/response-sale.dto.js';
import {
  ResponseRefundDto,
  ResponseReturnDto,
  ResponseReturnItemDto,
} from '../../returns/dto/response-return.dto.js';
import { PurchaseOverdraftResponseDto } from '../../purchases/dto/overdraft-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  CancelImpactResponseDto,
  CancelImpactStockItemDto,
} from '../../common-dto/response/cancel-impact.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import {
  cancelledRowMutationForbidden,
  customerRequiredForSale,
  discountExceedsSubtotal,
  duplicateFieldValue,
  insufficientStock,
  inventoryUnitIdRequiredForSale,
  resourceNotFound,
  saleCancelUnitNotSold,
  saleHasReturns,
  salePaidExceedsTotal,
  unitNotAvailableForSale,
  unwantedSaleItemField,
} from '../../errors/error.builder.js';
import {
  isUniqueConstraintViolation,
  violatedColumn,
} from '../../helpers/prisma-error-helper.js';

const SALE_INCLUDE = {
  customer: { select: { name: true } },
  items: {
    include: {
      product: { select: { name: true } },
      inventoryUnit: { select: { imei1: true } },
    },
  },
  payments: { orderBy: { createdAt: 'asc' as const } },
  saleReturns: {
    orderBy: { returnDate: 'asc' as const },
    include: {
      items: {
        include: {
          saleItem: {
            select: {
              productId: true,
              product: { select: { name: true } },
              inventoryUnit: { select: { imei1: true } },
            },
          },
        },
      },
      refunds: { orderBy: { createdAt: 'asc' as const } },
    },
  },
} satisfies Prisma.SaleInclude;

type SaleWithLines = Prisma.SaleGetPayload<{ include: typeof SALE_INCLUDE }>;

type Tx = Prisma.TransactionClient;

/** A validated sale line: DTO fields plus what validation learned. */
type ValidatedLine = CreateSaleDto['items'][number] & {
  productName: string;
  trackingType: string;
};

/**
 * A line after phase-1 locking: phone lines carry the locked unit id,
 * quantity lines the locked shelf count. unitCost is always snapshotted here,
 * under the lock, so phase 2 never re-reads a value that may have moved.
 */
type LockedLine =
  | { line: ValidatedLine; unitId: string; unitCost: bigint; available?: never }
  | {
      line: ValidatedLine;
      unitId?: never;
      unitCost: bigint;
      available: number;
    };

const CREATED = 'Sale created successfully';
const ALREADY_SAVED = 'Sale already saved';
const CANCELLED = 'Sale cancelled successfully';

export type CancelSaleResult =
  StatusBaseResponseDTO | PurchaseOverdraftResponseDto;

/**
 * WF9 — Create a Sale (cash / part payment / Udhar).
 *
 * One prisma.$transaction owns everything: counter → sales → sale_items →
 * stock → optional payment + cash. AGENTS rules that shape this code:
 *   4 — subtotal/total are computed here, never read from the client.
 *   5 — next_sale_no is read+incremented with UPDATE ... RETURNING.
 *   6 — clientRequestId replays instead of double-selling.
 *   7 — no overdraft prompt exists for sales: cash only ever enters the
 *       drawer from a sale, so it can never be driven below zero by it.
 */
@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async createSale(
    dto: CreateSaleDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // Idempotency first: a replayed request must answer "already saved" even
    // if the underlying master data has since changed (AGENTS rule 6).
    const existing = await this.prisma.sale.findFirst({
      where: { shopId, clientRequestId: dto.clientRequestId },
      select: { id: true },
    });
    if (existing) {
      return new StatusBaseResponseDTO(true, ALREADY_SAVED);
    }

    const customerId = dto.customerId ?? null;
    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, shopId },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundException(resourceNotFound('Customer', customerId));
      }
    }

    const lines = await this.validateLines(dto, shopId);

    // Rule 4: the server owns the money.
    const subtotal = lines.reduce(
      (sum, line) => sum + BigInt(line.quantity) * BigInt(line.unitPrice),
      0n,
    );
    const discount = BigInt(dto.discount ?? 0);
    if (discount > subtotal) {
      throw new BadRequestException(
        discountExceedsSubtotal(Number(discount), Number(subtotal)),
      );
    }
    const totalAmount = subtotal - discount;
    const paidNow = BigInt(dto.paidNow ?? 0);
    if (paidNow > totalAmount) {
      throw new BadRequestException(
        salePaidExceedsTotal(Number(totalAmount), Number(paidNow)),
      );
    }

    // WF9 step 1 + 4: a phone line or any unpaid balance needs a customer.
    const hasPhone = lines.some((line) => line.inventoryUnitId);
    const outstanding = totalAmount - paidNow;
    if ((hasPhone || outstanding > 0n) && !customerId) {
      throw new BadRequestException(customerRequiredForSale());
    }

    const saleMoment = new Date(dto.saleDate);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Rule 5: bump the counter under the shop row lock so two concurrent
        // sales can never share S-0001. The lock is taken first so sale and
        // purchase both acquire shop → stock in the same order.
        const rows = await tx.$queryRaw<Array<{ next: number }>>`
          UPDATE shops SET next_sale_no = next_sale_no + 1
          WHERE id = ${shopId}
          RETURNING next_sale_no - 1 AS next
        `;
        if (!rows?.length) {
          throw new NotFoundException(resourceNotFound('Shop', shopId));
        }

        // WF9 step 2: lock and re-check every line under its row lock BEFORE
        // anything is written — a bad line must not leave a half-sale behind.
        const lockedLines: LockedLine[] = [];
        for (const line of lines) {
          lockedLines.push(
            line.inventoryUnitId
              ? await this.lockPhoneLine(tx, line, shopId)
              : await this.lockQuantityLine(tx, line, shopId),
          );
        }

        const sale = await tx.sale.create({
          data: {
            shopId,
            customerId,
            saleNo: `S-${String(rows[0].next).padStart(4, '0')}`,
            saleDate: saleMoment,
            subtotal,
            discount,
            totalAmount,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            clientRequestId: dto.clientRequestId,
            notes: dto.notes?.trim() ? dto.notes : null,
            createdById: userId,
          },
          select: { id: true },
        });

        for (const locked of lockedLines) {
          await this.writeLine(tx, locked, sale.id, shopId);
        }

        if (paidNow > 0n) {
          const payment = await tx.payment.create({
            data: {
              shopId,
              customerId,
              saleId: sale.id,
              amount: paidNow,
              paymentDate: saleMoment,
              clientRequestId: dto.clientRequestId,
              createdById: userId,
            },
            select: { id: true },
          });
          await tx.cashMovement.create({
            data: {
              shopId,
              type: CashMovementType.CUSTOMER_PAYMENT,
              direction: CashDirection.IN,
              amount: paidNow,
              // The drawer ledger moves on the sale's business day, so a
              // back-dated sale shows its cash on that day (WF7 convention).
              movementDate: saleMoment,
              referenceType: ReferenceType.PAYMENT,
              referenceId: payment.id,
              createdById: userId,
            },
          });
        }
      });
    } catch (error) {
      // Two requests raced the same clientRequestId: the loser rolls back and
      // must answer "already saved", not 400 (rule 6).
      if (
        isUniqueConstraintViolation(error) &&
        violatedColumn(error, 'client_request_id')
      ) {
        return new StatusBaseResponseDTO(true, ALREADY_SAVED);
      }
      throw error;
    }

    return new StatusBaseResponseDTO(true, CREATED);
  }

  /**
   * WF12 — Cancel a Sale with reason.
   *
   * One $transaction: lock shop → lock the sale row → restore stock (units
   * SOLD → IN_STOCK, accessories +qty) with SALE_CANCEL movements → cancel
   * every ACTIVE payment of the sale and add one cash REVERSAL (OUT) per
   * payment → mark the sale CANCELLED with reason/time/user. Refunds leave
   * the drawer, so cash below zero is the usual soft overdraft prompt
   * (200, nothing written) confirmed with confirmOverdraft: true.
   */
  async cancelSale(
    id: string,
    dto: CancelSaleDto,
    shopId: string,
    userId: string,
  ): Promise<CancelSaleResult> {
    // Pre-transaction tenant + existence check so we 404 fast without a lock.
    const sale = await this.prisma.sale.findFirst({
      where: { id, shopId },
      select: { id: true, status: true, saleNo: true },
    });
    if (!sale) {
      throw new NotFoundException(resourceNotFound('Sale', id));
    }
    if (sale.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Sale', sale.saleNo),
      );
    }
    // WF15: a sale with returns can only be fixed by cancelling the returns —
    // never the sale (the payments and returns must all stay as history).
    const returnCount = await this.prisma.saleReturn.count({
      where: { shopId, saleId: id, status: RecordStatus.ACTIVE },
    });
    if (returnCount > 0) {
      throw new BadRequestException(saleHasReturns(sale.saleNo));
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      // Re-check under the sale row lock: two cancels racing the same sale
      // must not both pass the pre-check above (rule 8: cancel once).
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM sales
        WHERE id = ${id} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(resourceNotFound('Sale', id));
      }
      if (locked[0].status !== RecordStatus.ACTIVE) {
        throw new BadRequestException(
          cancelledRowMutationForbidden('Sale', sale.saleNo),
        );
      }

      // Re-checked under the lock: a return racing this cancel loses here.
      const inTxReturns = await tx.saleReturn.count({
        where: { shopId, saleId: id, status: RecordStatus.ACTIVE },
      });
      if (inTxReturns > 0) {
        throw new BadRequestException(saleHasReturns(sale.saleNo));
      }

      const items = await tx.saleItem.findMany({
        where: { saleId: id },
        select: {
          productId: true,
          inventoryUnitId: true,
          quantity: true,
          product: { select: { name: true } },
        },
      });
      const payments = await tx.payment.findMany({
        where: { shopId, saleId: id, status: RecordStatus.ACTIVE },
        select: { id: true, amount: true },
      });

      // The money leaving the drawer: one REVERSAL OUT per payment refunded.
      let refund = 0n;
      for (const payment of payments) refund += payment.amount;

      let overdraft = false;
      if (refund > 0n) {
        const after = (await this.currentCash(tx, shopId)) - Number(refund);
        if (after < 0) {
          if (!dto.confirmOverdraft) {
            return { kind: 'overdraft' as const, shortfall: -after };
          }
          overdraft = true;
        }
      }

      const now = new Date();

      for (const item of items) {
        if (item.inventoryUnitId) {
          await this.restoreUnit(
            tx,
            item.inventoryUnitId,
            item.productId,
            shopId,
            sale.saleNo,
            id,
            dto.cancelReason,
          );
        } else {
          await this.restoreStock(
            tx,
            item.productId,
            item.quantity,
            shopId,
            id,
            dto.cancelReason,
          );
        }
      }

      for (const payment of payments) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: RecordStatus.CANCELLED,
            cancelledAt: now,
            cancelReason: dto.cancelReason,
            cancelledById: userId,
          },
        });

        const original = await tx.cashMovement.findFirst({
          where: {
            shopId,
            type: CashMovementType.CUSTOMER_PAYMENT,
            referenceType: ReferenceType.PAYMENT,
            referenceId: payment.id,
          },
          select: { id: true },
        });
        if (!original) {
          throw new NotFoundException(
            resourceNotFound('Cash movement for payment', payment.id),
          );
        }

        await tx.cashMovement.create({
          data: {
            shopId,
            type: CashMovementType.REVERSAL,
            direction: CashDirection.OUT,
            amount: payment.amount,
            movementDate: now,
            referenceType: ReferenceType.PAYMENT,
            referenceId: payment.id,
            reversesMovementId: original.id,
            isOverdraft: overdraft,
            note: dto.cancelReason,
            createdById: userId,
          },
        });
      }

      await tx.sale.update({
        where: { id, shopId },
        data: {
          status: RecordStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: dto.cancelReason,
          cancelledById: userId,
        },
      });

      return { kind: 'cancelled' as const };
    });

    if (outcome.kind === 'overdraft') {
      return new PurchaseOverdraftResponseDto(
        outcome.shortfall,
        'sale cancellation',
      );
    }
    return new StatusBaseResponseDTO(true, CANCELLED);
  }

  /**
   * WF12 step 3 — the impact preview. Read-only twin of cancelSale: same
   * pre-checks and the same blocked conditions (phone not SOLD), but nothing
   * is locked or written — the owner sees stock back, cash reversed and the
   * resulting Udhar before POST .../cancel confirms.
   */
  async getCancelImpact(
    id: string,
    shopId: string,
  ): Promise<CancelImpactResponseDto> {
    const sale = await this.prisma.sale.findFirst({
      where: { id, shopId },
      select: {
        id: true,
        saleNo: true,
        status: true,
        totalAmount: true,
        customerId: true,
        items: {
          select: {
            inventoryUnitId: true,
            quantity: true,
            product: { select: { name: true } },
            inventoryUnit: { select: { imei1: true, status: true } },
          },
        },
      },
    });
    if (!sale) {
      throw new NotFoundException(resourceNotFound('Sale', id));
    }
    if (sale.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Sale', sale.saleNo),
      );
    }

    const payments = await this.prisma.payment.findMany({
      where: { shopId, saleId: id, status: RecordStatus.ACTIVE },
      select: { amount: true },
    });
    let refund = 0n;
    for (const payment of payments) refund += payment.amount;

    const currentCash = await this.currentCash(this.prisma, shopId);
    const cashAfter = currentCash - Number(refund);

    const stockItems: CancelImpactStockItemDto[] = [];
    let blocked = false;
    let blockedReason: string | null = null;
    // WF15: a sale with returns can never be cancelled — same message the
    // real cancel would refuse with, shown as "blocked" instead of 400.
    const impactReturnCount = await this.prisma.saleReturn.count({
      where: { shopId, saleId: id, status: RecordStatus.ACTIVE },
    });
    if (impactReturnCount > 0) {
      blocked = true;
      blockedReason = saleHasReturns(sale.saleNo).message.join(' ');
    }
    for (const item of sale.items) {
      if (item.inventoryUnitId) {
        const unit = item.inventoryUnit;
        if (!unit) {
          throw new NotFoundException(
            resourceNotFound('Inventory unit', item.inventoryUnitId),
          );
        }
        stockItems.push({
          productName: item.product.name,
          imei: unit.imei1,
          quantityChange: 1,
        });
        if (!blocked && unit.status !== UnitStatus.SOLD) {
          blocked = true;
          blockedReason = saleCancelUnitNotSold(
            sale.saleNo,
            unit.imei1,
            unit.status,
          ).message.join(' ');
        }
      } else {
        stockItems.push({
          productName: item.product.name,
          imei: null,
          quantityChange: item.quantity,
        });
      }
    }

    let customerUdharAfter: number | null = null;
    if (sale.customerId) {
      const [customer, salesAgg, paymentsAgg, returnsAgg, refundsAgg] =
        await Promise.all([
          this.prisma.customer.findFirst({
            where: { id: sale.customerId, shopId },
            select: { openingBalance: true },
          }),
          this.prisma.sale.aggregate({
            where: {
              shopId,
              customerId: sale.customerId,
              status: RecordStatus.ACTIVE,
            },
            _sum: { totalAmount: true },
          }),
          this.prisma.payment.aggregate({
            where: {
              shopId,
              customerId: sale.customerId,
              status: RecordStatus.ACTIVE,
            },
            _sum: { amount: true },
          }),
          this.prisma.saleReturn.aggregate({
            where: {
              shopId,
              customerId: sale.customerId,
              status: RecordStatus.ACTIVE,
            },
            _sum: { returnAmount: true },
          }),
          this.prisma.refund.aggregate({
            where: {
              shopId,
              saleReturn: {
                customerId: sale.customerId,
                status: RecordStatus.ACTIVE,
              },
            },
            _sum: { amount: true },
          }),
        ]);
      if (customer) {
        const balance =
          Number(customer.openingBalance) +
          Number(salesAgg._sum.totalAmount ?? 0n) -
          Number(paymentsAgg._sum.amount ?? 0n) -
          Number(returnsAgg._sum.returnAmount ?? 0n) +
          Number(refundsAgg._sum.amount ?? 0n);
        // Cancelling removes the sale and its payments from the derivation.
        customerUdharAfter =
          balance - Number(sale.totalAmount) + Number(refund);
      }
    }

    return {
      recordType: 'SALE',
      recordId: sale.id,
      recordNo: sale.saleNo,
      currentCash,
      cashReversedAmount: Number(refund),
      cashReversedDirection: 'OUT',
      cashAfter,
      willCauseOverdraft: cashAfter < 0,
      customerUdharAfter,
      supplierPayableAfter: null,
      stockItems,
      blocked,
      blockedReason,
    };
  }

  async getSales(
    query: SaleQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseSaleDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'saleDate';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.SaleWhereInput = { shopId };
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    const dateFilters: Prisma.SaleWhereInput[] = [];
    if (query.from)
      dateFilters.push({ saleDate: { gte: new Date(query.from) } });
    if (query.to) dateFilters.push({ saleDate: { lte: new Date(query.to) } });
    if (dateFilters.length > 0) where.AND = dateFilters;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { saleNo: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: SALE_INCLUDE,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseSaleDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  async getSaleById(id: string, shopId: string): Promise<ResponseSaleDto> {
    const row = await this.prisma.sale.findFirst({
      where: { id, shopId },
      include: SALE_INCLUDE,
    });
    if (!row) throw new NotFoundException(resourceNotFound('Sale', id));
    return this.toResponse(row);
  }

  /**
   * Pre-transaction line checks that need every product: right shop, right
   * tracking type for the line shape, and units unique inside this request.
   * Stock availability itself is checked under row locks inside the tx.
   */
  private async validateLines(
    dto: CreateSaleDto,
    shopId: string,
  ): Promise<ValidatedLine[]> {
    const productIds = [...new Set(dto.items.map((line) => line.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId },
      select: { id: true, name: true, trackingType: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const missing = productIds.find((id) => !byId.has(id));
    if (missing) {
      throw new NotFoundException(resourceNotFound('Product', missing));
    }

    const seenUnits = new Set<string>();
    return dto.items.map((line) => {
      const product = byId.get(line.productId)!;

      if (product.trackingType === 'SERIALIZED') {
        if (!line.inventoryUnitId) {
          throw new BadRequestException(
            inventoryUnitIdRequiredForSale(product.name),
          );
        }
        if (line.quantity !== 1) {
          throw new BadRequestException(
            unwantedSaleItemField(
              product.name,
              'quantity',
              'sells one specific phone, so quantity must be 1',
            ),
          );
        }
        if (seenUnits.has(line.inventoryUnitId)) {
          throw new BadRequestException(
            duplicateFieldValue(
              'Sale line',
              'inventoryUnitId',
              line.inventoryUnitId,
            ),
          );
        }
        seenUnits.add(line.inventoryUnitId);
      } else if (line.inventoryUnitId) {
        throw new BadRequestException(
          unwantedSaleItemField(
            product.name,
            'inventoryUnitId',
            'is tracked by quantity and does not use IMEIs',
          ),
        );
      }

      return {
        ...line,
        productName: product.name,
        trackingType: product.trackingType,
      };
    });
  }

  /**
   * Phone line phase 1: lock the unit row FOR UPDATE and re-check it is
   * IN_STOCK in this shop under the lock — a concurrent sale of the same IMEI
   * loses the race here, before anything is written.
   */
  private async lockPhoneLine(
    tx: Tx,
    line: ValidatedLine,
    shopId: string,
  ): Promise<LockedLine> {
    const locked = await tx.$queryRaw<
      Array<{ id: string; status: string; imei1: string; unit_cost: bigint }>
    >`
      SELECT id, status, imei1, unit_cost FROM inventory_units
      WHERE id = ${line.inventoryUnitId} AND shop_id = ${shopId}
        AND product_id = ${line.productId}
      FOR UPDATE
    `;
    if (!locked?.length) {
      throw new NotFoundException(
        resourceNotFound('Inventory unit', line.inventoryUnitId),
      );
    }
    const unit = locked[0];
    if (unit.status !== UnitStatus.IN_STOCK) {
      throw new BadRequestException(
        unitNotAvailableForSale(line.productName, unit.imei1, unit.status),
      );
    }
    return { line, unitId: unit.id, unitCost: BigInt(unit.unit_cost) };
  }

  /**
   * Accessory line phase 1: lock the stock row FOR UPDATE and re-check
   * quantityOnHand under the lock (PostgreSQL referees concurrent
   * double-sells). unitCost is snapshotted from avgUnitCost so profit never
   * changes when costs move later.
   */
  private async lockQuantityLine(
    tx: Tx,
    line: ValidatedLine,
    shopId: string,
  ): Promise<LockedLine> {
    const locked = await tx.$queryRaw<
      Array<{ quantity_on_hand: number; avg_unit_cost: bigint }>
    >`
      SELECT quantity_on_hand, avg_unit_cost FROM stock_levels
      WHERE product_id = ${line.productId} AND shop_id = ${shopId}
      FOR UPDATE
    `;
    const available = locked?.length ? Number(locked[0].quantity_on_hand) : 0;
    if (available < line.quantity) {
      throw new BadRequestException(
        insufficientStock(line.productName, available, line.quantity),
      );
    }
    return {
      line,
      available,
      unitCost: BigInt(locked[0].avg_unit_cost ?? 0),
    };
  }

  /** Phase 2: the sale row exists — write its line and move the stock. */
  private async writeLine(
    tx: Tx,
    locked: LockedLine,
    saleId: string,
    shopId: string,
  ): Promise<void> {
    const { line } = locked;

    await tx.saleItem.create({
      data: {
        shopId,
        saleId,
        productId: line.productId,
        inventoryUnitId: locked.unitId ?? null,
        quantity: locked.unitId ? 1 : line.quantity,
        unitPrice: BigInt(line.unitPrice),
        unitCost: locked.unitCost,
        total:
          BigInt(locked.unitId ? 1 : line.quantity) * BigInt(line.unitPrice),
      },
    });

    if (locked.unitId) {
      await tx.inventoryUnit.update({
        where: { id: locked.unitId },
        data: { status: UnitStatus.SOLD },
      });
    } else {
      await tx.stockLevel.update({
        where: { productId: line.productId },
        data: { quantityOnHand: locked.available! - line.quantity },
      });
    }

    await tx.inventoryMovement.create({
      data: {
        shopId,
        productId: line.productId,
        inventoryUnitId: locked.unitId ?? null,
        type: InventoryMovementType.SALE,
        quantityChange: locked.unitId ? -1 : -line.quantity,
        referenceType: ReferenceType.SALE,
        referenceId: saleId,
      },
    });
  }

  /** WF12: a sold phone goes back on the shelf (SOLD → IN_STOCK) with a +1 SALE_CANCEL movement. */
  private async restoreUnit(
    tx: Tx,
    unitId: string,
    productId: string,
    shopId: string,
    saleNo: string,
    saleId: string,
    reason: string,
  ): Promise<void> {
    const locked = await tx.$queryRaw<
      Array<{ id: string; status: string; imei1: string }>
    >`
      SELECT id, status, imei1 FROM inventory_units
      WHERE id = ${unitId} AND shop_id = ${shopId}
      FOR UPDATE
    `;
    if (!locked?.length) {
      throw new NotFoundException(resourceNotFound('Inventory unit', unitId));
    }
    const unit = locked[0];
    if (unit.status !== UnitStatus.SOLD) {
      throw new BadRequestException(
        saleCancelUnitNotSold(saleNo, unit.imei1, unit.status),
      );
    }

    await tx.inventoryUnit.update({
      where: { id: unitId },
      data: { status: UnitStatus.IN_STOCK },
    });
    await tx.inventoryMovement.create({
      data: {
        shopId,
        productId,
        inventoryUnitId: unitId,
        type: InventoryMovementType.SALE_CANCEL,
        quantityChange: 1,
        reason,
        referenceType: ReferenceType.SALE,
        referenceId: saleId,
      },
    });
  }

  /** WF12: sold accessories come back to the shelf with a +qty SALE_CANCEL movement. */
  private async restoreStock(
    tx: Tx,
    productId: string,
    quantity: number,
    shopId: string,
    saleId: string,
    reason: string,
  ): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ quantity_on_hand: number }>>`
      SELECT quantity_on_hand FROM stock_levels
      WHERE product_id = ${productId} AND shop_id = ${shopId}
      FOR UPDATE
    `;
    if (locked?.length) {
      await tx.stockLevel.update({
        where: { productId },
        data: {
          quantityOnHand: Number(locked[0].quantity_on_hand) + quantity,
        },
      });
    } else {
      // A sale implies a stock row exists, but a deleted-by-hand row must
      // not crash the cancel — recreate it with the returned quantity.
      await tx.stockLevel.create({
        data: { productId, shopId, quantityOnHand: quantity, avgUnitCost: 0n },
      });
    }

    await tx.inventoryMovement.create({
      data: {
        shopId,
        productId,
        type: InventoryMovementType.SALE_CANCEL,
        quantityChange: quantity,
        reason,
        referenceType: ReferenceType.SALE,
        referenceId: saleId,
      },
    });
  }

  private async currentCash(tx: Tx, shopId: string): Promise<number> {
    const inbound = await tx.cashMovement.aggregate({
      where: { shopId, direction: CashDirection.IN },
      _sum: { amount: true },
    });
    const outbound = await tx.cashMovement.aggregate({
      where: { shopId, direction: CashDirection.OUT },
      _sum: { amount: true },
    });
    return Number(inbound._sum.amount ?? 0) - Number(outbound._sum.amount ?? 0);
  }

  private toResponse(row: SaleWithLines): ResponseSaleDto {
    return {
      id: row.id,
      shopId: row.shopId,
      customerId: row.customerId,
      customerName: row.customer?.name,
      saleNo: row.saleNo,
      saleDate: row.saleDate,
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      totalAmount: Number(row.totalAmount),
      dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
      status: row.status,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      cancelledById: row.cancelledById,
      clientRequestId: row.clientRequestId,
      notes: row.notes,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: row.items.map((item): ResponseSaleItemDto => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        inventoryUnitId: item.inventoryUnitId,
        imei: item.inventoryUnit?.imei1 ?? null,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        unitCost: Number(item.unitCost),
        total: Number(item.total),
      })),
      payments: row.payments.map((payment): ResponsePaymentDto => ({
        id: payment.id,
        amount: Number(payment.amount),
        paymentDate: payment.paymentDate,
        method: payment.method,
        status: payment.status,
      })),
      // The header fields come from the parent sale — this include is nested,
      // so there is no sale join on the way back up.
      returns: row.saleReturns.map((ret): ResponseReturnDto => ({
        id: ret.id,
        saleId: ret.saleId,
        saleNo: row.saleNo,
        customerId: ret.customerId,
        customerName: row.customer?.name,
        returnDate: ret.returnDate,
        reason: ret.reason,
        returnAmount: Number(ret.returnAmount),
        status: ret.status,
        notes: ret.notes,
        createdById: ret.createdById,
        createdAt: ret.createdAt,
        updatedAt: ret.updatedAt,
        items: ret.items.map((item): ResponseReturnItemDto => ({
          id: item.id,
          saleItemId: item.saleItemId,
          inventoryUnitId: item.inventoryUnitId,
          imei: item.saleItem.inventoryUnit?.imei1 ?? null,
          productId: item.saleItem.productId,
          productName: item.saleItem.product.name,
          quantity: item.quantity,
          condition: item.condition,
        })),
        refunds: ret.refunds.map((refund): ResponseRefundDto => ({
          id: refund.id,
          amount: Number(refund.amount),
          refundDate: refund.refundDate,
          method: refund.method,
          notes: refund.notes,
        })),
      })),
    };
  }
}

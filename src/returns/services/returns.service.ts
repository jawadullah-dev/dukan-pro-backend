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
  PaymentMethod,
  RecordStatus,
  ReferenceType,
  ReturnCondition,
  UnitStatus,
} from '../../generated/prisma/enums.js';
import { CreateReturnDto } from '../dto/create-return.dto.js';
import { ReturnPreviewDto } from '../dto/return-preview.dto.js';
import { ReturnQueryFilterDto } from '../dto/return-query.filter.js';
import {
  ResponseRefundDto,
  ResponseReturnDto,
  ResponseReturnItemDto,
} from '../dto/response-return.dto.js';
import {
  ReturnPreviewLineDto,
  ReturnPreviewResponseDto,
} from '../dto/return-preview.dto.js';
import { PurchaseOverdraftResponseDto } from '../../purchases/dto/overdraft-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { businessDayRange } from '../../helpers/date.helper.js';
import {
  cancelledRowMutationForbidden,
  duplicateFieldValue,
  insufficientStock,
  refundExceedsAvailable,
  resourceNotFound,
  returnQuantityExceedsRemaining,
  returnQuantityRequired,
  unitAlreadyReturned,
  unitNotSoldForReturn,
  unwantedReturnItemField,
} from '../../errors/error.builder.js';

type Db = PrismaService | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

const CREATED = 'Return recorded successfully';

export type CreateReturnResult =
  StatusBaseResponseDTO | PurchaseOverdraftResponseDto;

const SALE_RETURN_SELECT = {
  id: true,
  saleNo: true,
  status: true,
  subtotal: true,
  discount: true,
  totalAmount: true,
  customerId: true,
  customer: { select: { name: true } },
  items: {
    select: {
      id: true,
      productId: true,
      inventoryUnitId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { name: true } },
      inventoryUnit: { select: { imei1: true, status: true } },
    },
  },
} satisfies Prisma.SaleSelect;

type SaleForReturn = Prisma.SaleGetPayload<{
  select: typeof SALE_RETURN_SELECT;
}>;

const RETURN_INCLUDE = {
  sale: { select: { saleNo: true } },
  customer: { select: { name: true } },
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
} satisfies Prisma.SaleReturnInclude;

type ReturnWithRefs = Prisma.SaleReturnGetPayload<{
  include: typeof RETURN_INCLUDE;
}>;

/** One input line joined with its sale line: what will actually be written. */
type PreparedLine = {
  saleItemId: string;
  productId: string;
  productName: string;
  inventoryUnitId: string | null;
  imei: string | null;
  unitPrice: bigint;
  quantity: number;
  condition: ReturnCondition;
};

type Settlement = {
  returnAmount: bigint;
  outstandingBefore: bigint;
  refundable: bigint;
  paidOnSale: bigint;
  refundedOnSale: bigint;
  priorReturns: bigint;
};

/**
 * WF15 — Return and Refund.
 *
 * One $transaction owns the save: lock shop → lock the sale row → validate
 * AGAIN under the lock (quantities, IMEI-once, money) → soft cash warning →
 * returns + return_items → stock restore (CUSTOMER_RETURN) with an extra
 * DAMAGED write-off pair when the condition is DAMAGED → refunds + cash
 * REFUND OUT. The sale itself and its payments are never touched.
 *
 * Settlement (WF15 steps 4–5): return value first cancels the sale's
 * outstanding Udhar; only the remainder that was actually paid can leave the
 * drawer. Outstanding = total − returns − active payments + refunds — the
 * same formula WF10 and the ledger use, so all three can never disagree.
 */
@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * WF15 step 4 — the dry run. Same validation and settlement as the save,
   * plus the cash picture. Read-only: no locks, no writes; the save
   * re-validates everything under the sale row lock.
   */
  async previewReturn(
    saleId: string,
    dto: ReturnPreviewDto,
    shopId: string,
  ): Promise<ReturnPreviewResponseDto> {
    const { sale, lines, settlement } = await this.prepare(
      this.prisma,
      saleId,
      shopId,
      dto.items,
    );

    const refundAmount = BigInt(dto.refundAmount ?? 0);
    if (refundAmount > settlement.refundable) {
      throw new BadRequestException(
        refundExceedsAvailable(
          Number(refundAmount),
          Number(settlement.refundable),
        ),
      );
    }

    const outstandingAfter =
      settlement.outstandingBefore - settlement.returnAmount + refundAmount;
    const currentCash = await this.currentCash(this.prisma, shopId);
    const cashAfter = currentCash - Number(refundAmount);

    return {
      saleId: sale.id,
      saleNo: sale.saleNo,
      customerName: sale.customer?.name ?? null,
      returnAmount: Number(settlement.returnAmount),
      outstandingBefore: Number(settlement.outstandingBefore),
      outstandingAfter: Number(outstandingAfter),
      refundable: Number(settlement.refundable),
      refundAmount: Number(refundAmount),
      currentCash,
      cashAfter,
      willCauseOverdraft: cashAfter < 0,
      items: lines.map((line): ReturnPreviewLineDto => ({
        saleItemId: line.saleItemId,
        productName: line.productName,
        imei: line.imei,
        quantity: line.quantity,
        condition: line.condition,
      })),
    };
  }

  /**
   * WF15 steps 5–9 — save the return. The pre-transaction pass fails fast
   * without a lock; the in-transaction pass under the sale row lock is the
   * authoritative one (a concurrent return or cancel loses here).
   * Refund > 0 can hit the usual soft overdraft prompt: 200 with nothing
   * written, retried with confirmOverdraft: true.
   */
  async createReturn(
    saleId: string,
    dto: CreateReturnDto,
    shopId: string,
    userId: string,
  ): Promise<CreateReturnResult> {
    const refundAmount = BigInt(dto.refundAmount ?? 0);
    const first = await this.prepare(this.prisma, saleId, shopId, dto.items);
    if (refundAmount > first.settlement.refundable) {
      throw new BadRequestException(
        refundExceedsAvailable(
          Number(refundAmount),
          Number(first.settlement.refundable),
        ),
      );
    }

    const returnMoment = new Date(dto.returnDate);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      // Re-check under the sale row lock: a cancel or a second return racing
      // this one must lose here, before anything is written.
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM sales
        WHERE id = ${saleId} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(resourceNotFound('Sale', saleId));
      }
      if (locked[0].status !== RecordStatus.ACTIVE) {
        throw new BadRequestException(
          cancelledRowMutationForbidden('Sale', first.sale.saleNo),
        );
      }

      const fresh = await this.prepare(tx, saleId, shopId, dto.items);

      let overdraft = false;
      if (refundAmount > 0n) {
        const after =
          (await this.currentCash(tx, shopId)) - Number(refundAmount);
        if (after < 0) {
          if (!dto.confirmOverdraft) {
            return { kind: 'overdraft' as const, shortfall: -after };
          }
          overdraft = true;
        }
      }

      const returnRow = await tx.saleReturn.create({
        data: {
          shopId,
          saleId,
          customerId: fresh.sale.customerId,
          returnDate: returnMoment,
          reason: dto.reason,
          returnAmount: fresh.settlement.returnAmount,
          notes: dto.notes?.trim() ? dto.notes : null,
          createdById: userId,
        },
        select: { id: true },
      });

      for (const line of fresh.lines) {
        await tx.returnItem.create({
          data: {
            shopId,
            returnId: returnRow.id,
            saleItemId: line.saleItemId,
            inventoryUnitId: line.inventoryUnitId,
            quantity: line.quantity,
            condition: line.condition,
          },
        });
      }

      for (const line of fresh.lines) {
        await this.restoreLine(
          tx,
          fresh.sale,
          line,
          shopId,
          returnRow.id,
          dto.reason,
        );
        if (line.condition === ReturnCondition.DAMAGED) {
          await this.writeOffLine(tx, line, shopId, returnRow.id, dto.reason);
        }
      }

      if (refundAmount > 0n) {
        const refund = await tx.refund.create({
          data: {
            shopId,
            returnId: returnRow.id,
            amount: refundAmount,
            refundDate: returnMoment,
            method: PaymentMethod.CASH,
            notes: dto.notes?.trim() ? dto.notes : null,
            createdById: userId,
          },
          select: { id: true },
        });
        await tx.cashMovement.create({
          data: {
            shopId,
            type: CashMovementType.REFUND,
            direction: CashDirection.OUT,
            amount: refundAmount,
            movementDate: returnMoment,
            referenceType: ReferenceType.REFUND,
            referenceId: refund.id,
            isOverdraft: overdraft,
            note: dto.reason,
            createdById: userId,
          },
        });
      }

      return { kind: 'created' as const };
    });

    if (outcome.kind === 'overdraft') {
      return new PurchaseOverdraftResponseDto(outcome.shortfall, 'refund');
    }
    return new StatusBaseResponseDTO(true, CREATED);
  }

  async getReturns(
    query: ReturnQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseReturnDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'returnDate';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.SaleReturnWhereInput = { shopId };
    if (query.saleId) where.saleId = query.saleId;
    if (query.customerId) where.customerId = query.customerId;
    const dateFilters: Prisma.SaleReturnWhereInput[] = [];
    if (query.from)
      dateFilters.push({
        returnDate: { gte: businessDayRange(query.from).start },
      });
    if (query.to)
      dateFilters.push({ returnDate: { lt: businessDayRange(query.to).end } });
    if (dateFilters.length > 0) where.AND = dateFilters;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { sale: { saleNo: { contains: term, mode: 'insensitive' } } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        { reason: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.saleReturn.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: RETURN_INCLUDE,
      }),
      this.prisma.saleReturn.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseReturnDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  async getReturnById(id: string, shopId: string): Promise<ResponseReturnDto> {
    const row = await this.prisma.saleReturn.findFirst({
      where: { id, shopId },
      include: RETURN_INCLUDE,
    });
    if (!row) throw new NotFoundException(resourceNotFound('Return', id));
    return this.toResponse(row);
  }

  /**
   * The one validation + settlement path, shared by preview, the
   * pre-transaction fast fail and the authoritative in-transaction pass:
   * load the sale (tenant check is the `{ id, shopId }` read itself), check
   * every line's shape and remaining quantity, then compute the money from
   * ACTIVE rows only.
   */
  private async prepare(
    db: Db,
    saleId: string,
    shopId: string,
    inputs: CreateReturnDto['items'],
  ): Promise<{
    sale: SaleForReturn;
    lines: PreparedLine[];
    settlement: Settlement;
  }> {
    const sale = await db.sale.findFirst({
      where: { id: saleId, shopId },
      select: SALE_RETURN_SELECT,
    });
    if (!sale) {
      throw new NotFoundException(resourceNotFound('Sale', saleId));
    }
    if (sale.status !== RecordStatus.ACTIVE) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Sale', sale.saleNo),
      );
    }

    const lines = await this.validateLines(db, sale, shopId, inputs);
    const settlement = await this.settle(db, sale, shopId, lines);
    return { sale, lines, settlement };
  }

  /** WF15 step 2 — line shape, per-line rules and sold-minus-returned. */
  private async validateLines(
    db: Db,
    sale: SaleForReturn,
    shopId: string,
    inputs: CreateReturnDto['items'],
  ): Promise<PreparedLine[]> {
    const byId = new Map(sale.items.map((item) => [item.id, item]));

    const seenPhoneLines = new Set<string>();
    const requestedByLine = new Map<string, number>();
    const chosen: Array<{
      saleItemId: string;
      quantity: number;
      condition: ReturnCondition;
    }> = [];

    for (const input of inputs) {
      const saleItem = byId.get(input.saleItemId);
      if (!saleItem) {
        throw new NotFoundException(
          resourceNotFound('Sale item', input.saleItemId),
        );
      }
      const productName = saleItem.product.name;

      if (saleItem.inventoryUnitId) {
        if (input.quantity !== undefined && input.quantity !== 1) {
          throw new BadRequestException(
            unwantedReturnItemField(
              productName,
              'quantity',
              'sells one specific phone, so quantity must be 1 or left out',
            ),
          );
        }
        if (seenPhoneLines.has(input.saleItemId)) {
          throw new BadRequestException(
            duplicateFieldValue('Return line', 'saleItemId', input.saleItemId),
          );
        }
        seenPhoneLines.add(input.saleItemId);
        chosen.push({
          saleItemId: input.saleItemId,
          quantity: 1,
          condition: input.condition,
        });
      } else {
        if (input.quantity === undefined) {
          throw new BadRequestException(returnQuantityRequired(productName));
        }
        requestedByLine.set(
          input.saleItemId,
          (requestedByLine.get(input.saleItemId) ?? 0) + input.quantity,
        );
        chosen.push({
          saleItemId: input.saleItemId,
          quantity: input.quantity,
          condition: input.condition,
        });
      }
    }

    const priorRows = await db.returnItem.findMany({
      where: {
        saleItemId: { in: [...new Set(chosen.map((c) => c.saleItemId))] },
        saleReturn: { saleId: sale.id, shopId, status: RecordStatus.ACTIVE },
      },
      select: { saleItemId: true, quantity: true },
    });
    const returnedByLine = new Map<string, number>();
    for (const row of priorRows) {
      returnedByLine.set(
        row.saleItemId,
        (returnedByLine.get(row.saleItemId) ?? 0) + row.quantity,
      );
    }

    // Accessories: the AGGREGATE of this request plus earlier returns must
    // stay inside sold minus returned (two same-line entries add up).
    for (const [saleItemId, requested] of requestedByLine) {
      const saleItem = byId.get(saleItemId)!;
      const remaining =
        saleItem.quantity - (returnedByLine.get(saleItemId) ?? 0);
      if (requested > remaining) {
        throw new BadRequestException(
          returnQuantityExceedsRemaining(
            sale.saleNo,
            saleItem.product.name,
            requested,
            remaining,
          ),
        );
      }
    }

    return chosen.map((c) => {
      const saleItem = byId.get(c.saleItemId)!;
      if (saleItem.inventoryUnitId) {
        const unit = saleItem.inventoryUnit;
        if (!unit) {
          throw new NotFoundException(
            resourceNotFound('Inventory unit', saleItem.inventoryUnitId),
          );
        }
        if ((returnedByLine.get(c.saleItemId) ?? 0) > 0) {
          throw new BadRequestException(
            unitAlreadyReturned(sale.saleNo, unit.imei1),
          );
        }
        if (unit.status !== UnitStatus.SOLD) {
          throw new BadRequestException(
            unitNotSoldForReturn(sale.saleNo, unit.imei1, unit.status),
          );
        }
        return {
          saleItemId: c.saleItemId,
          productId: saleItem.productId,
          productName: saleItem.product.name,
          inventoryUnitId: saleItem.inventoryUnitId,
          imei: unit.imei1,
          unitPrice: saleItem.unitPrice,
          quantity: c.quantity,
          condition: c.condition,
        };
      }
      return {
        saleItemId: c.saleItemId,
        productId: saleItem.productId,
        productName: saleItem.product.name,
        inventoryUnitId: null,
        imei: null,
        unitPrice: saleItem.unitPrice,
        quantity: c.quantity,
        condition: c.condition,
      };
    });
  }

  /**
   * WF15 step 3's money and step 4's settlement, all server-computed:
   *   returnAmount   = Σ quantity × unitPrice − pro-rata share of the discount
   *   outstanding    = total − prior returns − active payments + refunds
   *   refundable     = min(return value − outstanding, paid − earlier refunds)
   * BigInt throughout; the discount share floors, which never over-refunds.
   */
  private async settle(
    db: Db,
    sale: SaleForReturn,
    shopId: string,
    lines: PreparedLine[],
  ): Promise<Settlement> {
    const paymentsAgg = await db.payment.aggregate({
      where: { shopId, saleId: sale.id, status: RecordStatus.ACTIVE },
      _sum: { amount: true },
    });
    const returnsAgg = await db.saleReturn.aggregate({
      where: { shopId, saleId: sale.id, status: RecordStatus.ACTIVE },
      _sum: { returnAmount: true },
    });
    const refundsAgg = await db.refund.aggregate({
      where: {
        shopId,
        saleReturn: { saleId: sale.id, shopId, status: RecordStatus.ACTIVE },
      },
      _sum: { amount: true },
    });

    const paid = paymentsAgg._sum.amount ?? 0n;
    const priorReturns = returnsAgg._sum.returnAmount ?? 0n;
    const refunded = refundsAgg._sum.amount ?? 0n;

    let gross = 0n;
    for (const line of lines) {
      gross += line.unitPrice * BigInt(line.quantity);
    }
    // Full return ⇒ gross === subtotal ⇒ the division is exact and the
    // customer gets back exactly what the sale total said.
    const discountShare =
      sale.subtotal > 0n ? (sale.discount * gross) / sale.subtotal : 0n;
    const returnAmount = gross - discountShare;

    const outstandingBefore = sale.totalAmount - priorReturns - paid + refunded;
    const byUdhar =
      returnAmount > outstandingBefore ? returnAmount - outstandingBefore : 0n;
    const byCash = paid > refunded ? paid - refunded : 0n;
    const refundable = byUdhar < byCash ? byUdhar : byCash;

    return {
      returnAmount,
      outstandingBefore,
      refundable,
      paidOnSale: paid,
      refundedOnSale: refunded,
      priorReturns,
    };
  }

  /**
   * WF15 step 7 — the item is sellable again: phones SOLD → IN_STOCK with a
   * +1 CUSTOMER_RETURN movement, accessories stock_levels +qty with +qty.
   * The unit row / stock row is locked FOR UPDATE and re-checked here, so a
   * status that moved under us loses before any write.
   */
  private async restoreLine(
    tx: Tx,
    sale: SaleForReturn,
    line: PreparedLine,
    shopId: string,
    returnId: string,
    reason: string,
  ): Promise<void> {
    if (line.inventoryUnitId) {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string; imei1: string }>
      >`
        SELECT id, status, imei1 FROM inventory_units
        WHERE id = ${line.inventoryUnitId} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(
          resourceNotFound('Inventory unit', line.inventoryUnitId),
        );
      }
      const unit = locked[0];
      if (unit.status !== UnitStatus.SOLD) {
        throw new BadRequestException(
          unitNotSoldForReturn(sale.saleNo, unit.imei1, unit.status),
        );
      }

      await tx.inventoryUnit.update({
        where: { id: unit.id },
        data: { status: UnitStatus.IN_STOCK },
      });
      await tx.inventoryMovement.create({
        data: {
          shopId,
          productId: line.productId,
          inventoryUnitId: unit.id,
          type: InventoryMovementType.CUSTOMER_RETURN,
          quantityChange: 1,
          reason,
          referenceType: ReferenceType.RETURN,
          referenceId: returnId,
        },
      });
      return;
    }

    const locked = await tx.$queryRaw<Array<{ quantity_on_hand: number }>>`
      SELECT quantity_on_hand FROM stock_levels
      WHERE product_id = ${line.productId} AND shop_id = ${shopId}
      FOR UPDATE
    `;
    if (locked?.length) {
      await tx.stockLevel.update({
        where: { productId: line.productId },
        data: {
          quantityOnHand: Number(locked[0].quantity_on_hand) + line.quantity,
        },
      });
    } else {
      // A sale implies a stock row exists, but a missing row must not crash
      // the return — recreate it with the returned quantity (WF12 pattern).
      await tx.stockLevel.create({
        data: {
          productId: line.productId,
          shopId,
          quantityOnHand: line.quantity,
          avgUnitCost: 0n,
        },
      });
    }
    await tx.inventoryMovement.create({
      data: {
        shopId,
        productId: line.productId,
        type: InventoryMovementType.CUSTOMER_RETURN,
        quantityChange: line.quantity,
        reason,
        referenceType: ReferenceType.RETURN,
        referenceId: returnId,
      },
    });
  }

  /**
   * WF15 step 8 — a DAMAGED item must not stay sellable, and the ledger must
   * explain why. The unit/stock was just restored by restoreLine, so this is
   * the WF8 write-off on top: status DAMAGED / conditional −qty plus a
   * DAMAGED movement. The pair (CUSTOMER_RETURN +n, DAMAGED −n) keeps
   * inventory_movements summing to current sellable stock — the same
   * double-entry invariant every other flow preserves; a lone DAMAGED row
   * would need quantity_change ≠ 0 (DB CHECK) and would break the sum.
   */
  private async writeOffLine(
    tx: Tx,
    line: PreparedLine,
    shopId: string,
    returnId: string,
    reason: string,
  ): Promise<void> {
    if (line.inventoryUnitId) {
      await tx.inventoryUnit.update({
        where: { id: line.inventoryUnitId },
        data: { status: UnitStatus.DAMAGED },
      });
      await tx.inventoryMovement.create({
        data: {
          shopId,
          productId: line.productId,
          inventoryUnitId: line.inventoryUnitId,
          type: InventoryMovementType.DAMAGED,
          quantityChange: -1,
          reason,
          referenceType: ReferenceType.RETURN,
          referenceId: returnId,
        },
      });
      return;
    }

    const removed = await tx.$executeRaw`
      UPDATE stock_levels
      SET quantity_on_hand = quantity_on_hand - ${line.quantity}, updated_at = now()
      WHERE product_id = ${line.productId} AND shop_id = ${shopId}
        AND quantity_on_hand >= ${line.quantity}
    `;
    if (removed === 0) {
      const current = await tx.stockLevel.findUnique({
        where: { productId: line.productId },
        select: { quantityOnHand: true },
      });
      throw new BadRequestException(
        insufficientStock(
          line.productName,
          current?.quantityOnHand ?? 0,
          line.quantity,
        ),
      );
    }
    await tx.inventoryMovement.create({
      data: {
        shopId,
        productId: line.productId,
        type: InventoryMovementType.DAMAGED,
        quantityChange: -line.quantity,
        reason,
        referenceType: ReferenceType.RETURN,
        referenceId: returnId,
      },
    });
  }

  private async currentCash(db: Db, shopId: string): Promise<number> {
    const inbound = await db.cashMovement.aggregate({
      where: { shopId, direction: CashDirection.IN },
      _sum: { amount: true },
    });
    const outbound = await db.cashMovement.aggregate({
      where: { shopId, direction: CashDirection.OUT },
      _sum: { amount: true },
    });
    return Number(inbound._sum.amount ?? 0) - Number(outbound._sum.amount ?? 0);
  }

  private toResponse(row: ReturnWithRefs): ResponseReturnDto {
    return {
      id: row.id,
      saleId: row.saleId,
      saleNo: row.sale.saleNo,
      customerId: row.customerId,
      customerName: row.customer?.name,
      returnDate: row.returnDate,
      reason: row.reason,
      returnAmount: Number(row.returnAmount),
      status: row.status,
      notes: row.notes,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: row.items.map((item): ResponseReturnItemDto => ({
        id: item.id,
        saleItemId: item.saleItemId,
        inventoryUnitId: item.inventoryUnitId,
        imei: item.saleItem.inventoryUnit?.imei1 ?? null,
        productId: item.saleItem.productId,
        productName: item.saleItem.product.name,
        quantity: item.quantity,
        condition: item.condition,
      })),
      refunds: row.refunds.map((refund): ResponseRefundDto => ({
        id: refund.id,
        amount: Number(refund.amount),
        refundDate: refund.refundDate,
        method: refund.method,
        notes: refund.notes,
      })),
    };
  }
}

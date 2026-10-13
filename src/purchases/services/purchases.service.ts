import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CashDirection,
  CashMovementType,
  InventoryMovementType,
  RecordStatus,
  ReferenceType,
  UnitCondition,
  UnitStatus,
} from '../../generated/prisma/enums.js';
import { CreatePurchaseDto } from '../dto/create-purchase.dto.js';
import { CancelPurchaseDto } from '../dto/cancel-purchase.dto.js';
import { PurchaseQueryFilterDto } from '../dto/purchase-query.filter.js';
import {
  ResponsePurchaseDto,
  ResponsePurchaseItemDto,
} from '../dto/response-purchase.dto.js';
import { PurchaseOverdraftResponseDto } from '../dto/overdraft-response.dto.js';
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
  duplicateImei,
  imeisCountMismatch,
  imeisNotAllowed,
  insufficientStock,
  openingStockCannotTakePayment,
  purchaseCancelUnitNotInStock,
  purchasePaidExceedsTotal,
  resourceNotFound,
} from '../../errors/error.builder.js';
import {
  isUniqueConstraintViolation,
  violatedColumn,
} from '../../helpers/prisma-error-helper.js';

const PURCHASE_INCLUDE = {
  supplier: { select: { name: true } },
  items: {
    include: {
      product: { select: { name: true } },
      inventoryUnits: { select: { imei1: true } },
    },
  },
} satisfies Prisma.PurchaseInclude;

type PurchaseWithLines = Prisma.PurchaseGetPayload<{
  include: typeof PURCHASE_INCLUDE;
}>;

export type CreatePurchaseResult =
  StatusBaseResponseDTO | PurchaseOverdraftResponseDto;

type Tx = Prisma.TransactionClient;

const CREATED = 'Purchase created successfully';
const ALREADY_SAVED = 'Purchase already saved';
const CANCELLED = 'Purchase cancelled successfully';

/**
 * WF6 — Purchase (Stock In).
 *
 * Everything a purchase touches is written inside ONE prisma.$transaction:
 * counter → purchases → purchase_items → inventory → optional payment + cash.
 * AGENTS rule 4: the client never sends totalAmount; line costs are multiplied
 * out here. Rule 5: next_purchase_no is read+incremented with
 * UPDATE ... RETURNING so two concurrent saves cannot share P-0001.
 */
@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createPurchase(
    dto: CreatePurchaseDto,
    shopId: string,
    userId: string,
  ): Promise<CreatePurchaseResult> {
    // Idempotency first: a replayed request must answer "already saved" even
    // if the underlying master data has since changed (AGENTS rule 6).
    const existing = await this.prisma.purchase.findFirst({
      where: { shopId, clientRequestId: dto.clientRequestId },
      select: { id: true },
    });
    if (existing) {
      return new StatusBaseResponseDTO(true, ALREADY_SAVED);
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, shopId },
      select: { id: true },
    });
    if (!supplier) {
      throw new NotFoundException(resourceNotFound('Supplier', dto.supplierId));
    }

    const items = await this.validateLines(dto, shopId);

    const totalAmount = items.reduce(
      (sum, line) => sum + BigInt(line.quantity) * BigInt(line.unitCost),
      0n,
    );
    const paidNow = BigInt(dto.paidNow ?? 0);

    if (dto.isOpeningStock && paidNow > 0n) {
      throw new BadRequestException(openingStockCannotTakePayment());
    }
    if (!dto.isOpeningStock && paidNow > totalAmount) {
      throw new BadRequestException(
        purchasePaidExceedsTotal(Number(totalAmount), Number(paidNow)),
      );
    }

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        // Serialise this shop's cash reads: the currentCash aggregate below is
        // a snapshot of committed rows, so without a lock two concurrent
        // purchases would each pass the overdraft check on the same balance
        // and double-draw the drawer. Locking the shop row first makes the
        // second writer wait; after the first commits it re-reads the new
        // balance (README: READ COMMITTED re-snapshots per statement).
        const shop = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
        `;
        if (!shop?.length) {
          throw new NotFoundException(resourceNotFound('Shop', shopId));
        }

        let overdraft = false;
        if (paidNow > 0n) {
          const after = (await this.currentCash(tx, shopId)) - Number(paidNow);
          if (after < 0) {
            if (!dto.confirmOverdraft) {
              return { kind: 'overdraft' as const, shortfall: -after };
            }
            overdraft = true;
          }
        }

        const purchase = await this.insertPurchase(
          tx,
          dto,
          shopId,
          userId,
          totalAmount,
        );

        for (const line of items) {
          const purchaseItem = await tx.purchaseItem.create({
            data: {
              shopId,
              purchaseId: purchase.id,
              productId: line.productId,
              quantity: line.quantity,
              unitCost: BigInt(line.unitCost),
              totalCost: BigInt(line.quantity) * BigInt(line.unitCost),
            },
          });
          await this.applyStock(tx, shopId, purchase.id, purchaseItem.id, line);
        }

        if (paidNow > 0n) {
          await tx.supplierPayment.create({
            data: {
              shopId,
              supplierId: dto.supplierId,
              purchaseId: purchase.id,
              amount: paidNow,
              paymentDate: new Date(dto.purchaseDate),
              createdById: userId,
            },
          });
          await tx.cashMovement.create({
            data: {
              shopId,
              type: CashMovementType.SUPPLIER_PAYMENT,
              direction: CashDirection.OUT,
              amount: paidNow,
              movementDate: new Date(dto.purchaseDate),
              referenceType: ReferenceType.PURCHASE,
              referenceId: purchase.id,
              isOverdraft: overdraft,
              createdById: userId,
            },
          });
        }

        return { kind: 'created' as const };
      });

      if (outcome.kind === 'overdraft') {
        return new PurchaseOverdraftResponseDto(outcome.shortfall);
      }
      return new StatusBaseResponseDTO(true, CREATED);
    } catch (error) {
      // Two requests raced the same clientRequestId: the loser rolls back and
      // must answer "already saved", not 400.
      if (
        isUniqueConstraintViolation(error) &&
        violatedColumn(error, 'client_request_id')
      ) {
        return new StatusBaseResponseDTO(true, ALREADY_SAVED);
      }
      if (
        isUniqueConstraintViolation(error) &&
        violatedColumn(error, 'imei1')
      ) {
        // The unique index fired inside the transaction, so name the IMEI
        // that actually collided rather than a placeholder.
        const allImeis = [
          ...new Set(dto.items.flatMap((line) => line.imeis ?? [])),
        ];
        const inUse = await this.prisma.inventoryUnit.findFirst({
          where: { shopId, imei1: { in: allImeis } },
          select: { imei1: true },
        });
        throw new BadRequestException(
          duplicateImei(inUse?.imei1 ?? allImeis[0] ?? 'that IMEI'),
        );
      }
      throw error;
    }
  }

  /**
   * WF12 — Cancel a Purchase with reason.
   *
   * One $transaction: lock shop → lock the purchase row → lock and check
   * every phone (must be IN_STOCK) and every accessory line (stock must not
   * go negative) → phones VOIDED, accessories decremented, PURCHASE_CANCEL
   * movements → cancel this bill's ACTIVE supplier_payments with one cash
   * REVERSAL (IN) each → purchase CANCELLED with reason/time/user.
   *
   * Reversals only add cash, so unlike WF6 there is no overdraft prompt.
   * Hard blocks (rule 7): a phone sold/damaged/lost from this bill, or
   * accessory stock already consumed by a later sale.
   */
  async cancelPurchase(
    id: string,
    dto: CancelPurchaseDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // Pre-transaction tenant + existence check so we 404 fast without a lock.
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, shopId },
      select: { id: true, status: true, purchaseNo: true },
    });
    if (!purchase) {
      throw new NotFoundException(resourceNotFound('Purchase', id));
    }
    if (purchase.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Purchase', purchase.purchaseNo),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      // Re-check under the purchase row lock: two cancels racing the same
      // purchase must not both pass the pre-check (rule 8: cancel once).
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM purchases
        WHERE id = ${id} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(resourceNotFound('Purchase', id));
      }
      if (locked[0].status !== RecordStatus.ACTIVE) {
        throw new BadRequestException(
          cancelledRowMutationForbidden('Purchase', purchase.purchaseNo),
        );
      }

      const items = await tx.purchaseItem.findMany({
        where: { purchaseId: id },
        select: {
          productId: true,
          quantity: true,
          product: { select: { name: true, trackingType: true } },
          inventoryUnits: { select: { id: true, imei1: true } },
        },
      });

      const now = new Date();

      // Validate-and-write line by line under row locks: every phone must
      // still be IN_STOCK and every accessory count must still be on the
      // shelf, otherwise the cancel would invent or destroy stock.
      for (const item of items) {
        if (item.product.trackingType === 'SERIALIZED') {
          for (const unit of item.inventoryUnits) {
            const lockedUnit = await tx.$queryRaw<
              Array<{ id: string; status: string; imei1: string }>
            >`
              SELECT id, status, imei1 FROM inventory_units
              WHERE id = ${unit.id} AND shop_id = ${shopId}
              FOR UPDATE
            `;
            if (!lockedUnit?.length) {
              throw new NotFoundException(
                resourceNotFound('Inventory unit', unit.id),
              );
            }
            if (lockedUnit[0].status !== UnitStatus.IN_STOCK) {
              throw new BadRequestException(
                purchaseCancelUnitNotInStock(
                  purchase.purchaseNo,
                  lockedUnit[0].imei1,
                  lockedUnit[0].status,
                ),
              );
            }

            await tx.inventoryUnit.update({
              where: { id: unit.id },
              data: { status: UnitStatus.VOIDED },
            });
            await tx.inventoryMovement.create({
              data: {
                shopId,
                productId: item.productId,
                inventoryUnitId: unit.id,
                type: InventoryMovementType.PURCHASE_CANCEL,
                quantityChange: -1,
                reason: dto.cancelReason,
                referenceType: ReferenceType.PURCHASE,
                referenceId: id,
              },
            });
          }
          continue;
        }

        const lockedStock = await tx.$queryRaw<
          Array<{ quantity_on_hand: number }>
        >`
          SELECT quantity_on_hand FROM stock_levels
          WHERE product_id = ${item.productId} AND shop_id = ${shopId}
          FOR UPDATE
        `;
        const available = lockedStock?.length
          ? Number(lockedStock[0].quantity_on_hand)
          : 0;
        if (available < item.quantity) {
          throw new BadRequestException(
            insufficientStock(item.product.name, available, item.quantity),
          );
        }

        await tx.stockLevel.update({
          where: { productId: item.productId },
          data: { quantityOnHand: available - item.quantity },
        });
        await tx.inventoryMovement.create({
          data: {
            shopId,
            productId: item.productId,
            type: InventoryMovementType.PURCHASE_CANCEL,
            quantityChange: -item.quantity,
            reason: dto.cancelReason,
            referenceType: ReferenceType.PURCHASE,
            referenceId: id,
          },
        });
      }

      // Payable shrinks on both sides: cancel this bill's payments and put
      // their cash back with one REVERSAL (IN) each.
      const payments = await tx.supplierPayment.findMany({
        where: { shopId, purchaseId: id, status: RecordStatus.ACTIVE },
        select: { id: true, amount: true },
      });
      for (const payment of payments) {
        await tx.supplierPayment.update({
          where: { id: payment.id },
          data: {
            status: RecordStatus.CANCELLED,
            cancelledAt: now,
            cancelReason: dto.cancelReason,
            cancelledById: userId,
          },
        });

        const original = await this.originalSupplierCash(
          tx,
          shopId,
          payment.id,
          id,
        );
        if (!original) {
          throw new NotFoundException(
            resourceNotFound('Cash movement for supplier payment', payment.id),
          );
        }

        await tx.cashMovement.create({
          data: {
            shopId,
            type: CashMovementType.REVERSAL,
            direction: CashDirection.IN,
            amount: payment.amount,
            movementDate: now,
            referenceType: ReferenceType.SUPPLIER_PAYMENT,
            referenceId: payment.id,
            reversesMovementId: original.id,
            note: dto.cancelReason,
            createdById: userId,
          },
        });
      }

      await tx.purchase.update({
        where: { id, shopId },
        data: {
          status: RecordStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: dto.cancelReason,
          cancelledById: userId,
        },
      });
    });

    return new StatusBaseResponseDTO(true, CANCELLED);
  }

  /**
   * WF12 step 3 — the impact preview. Read-only twin of cancelPurchase: it
   * evaluates the same blockers (phone not IN_STOCK, accessory stock short)
   * against uncommitted reads and reports them as blocked/blockedReason
   * instead of throwing, so the UI can grey out Confirm. Writes nothing.
   */
  async getCancelImpact(
    id: string,
    shopId: string,
  ): Promise<CancelImpactResponseDto> {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, shopId },
      select: {
        id: true,
        purchaseNo: true,
        status: true,
        totalAmount: true,
        supplierId: true,
        isOpeningStock: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            product: { select: { name: true, trackingType: true } },
            inventoryUnits: { select: { imei1: true, status: true } },
          },
        },
      },
    });
    if (!purchase) {
      throw new NotFoundException(resourceNotFound('Purchase', id));
    }
    if (purchase.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Purchase', purchase.purchaseNo),
      );
    }

    const stockItems: CancelImpactStockItemDto[] = [];
    let blocked = false;
    let blockedReason: string | null = null;
    for (const item of purchase.items) {
      if (item.product.trackingType === 'SERIALIZED') {
        for (const unit of item.inventoryUnits) {
          stockItems.push({
            productName: item.product.name,
            imei: unit.imei1,
            quantityChange: -1,
          });
          if (!blocked && unit.status !== UnitStatus.IN_STOCK) {
            blocked = true;
            blockedReason = purchaseCancelUnitNotInStock(
              purchase.purchaseNo,
              unit.imei1,
              unit.status,
            ).message.join(' ');
          }
        }
        continue;
      }

      stockItems.push({
        productName: item.product.name,
        imei: null,
        quantityChange: -item.quantity,
      });
      const stock = await this.prisma.stockLevel.findFirst({
        where: { productId: item.productId, shopId },
        select: { quantityOnHand: true },
      });
      const available = stock ? Number(stock.quantityOnHand) : 0;
      if (!blocked && available < item.quantity) {
        blocked = true;
        blockedReason = insufficientStock(
          item.product.name,
          available,
          item.quantity,
        ).message.join(' ');
      }
    }

    const billPayments = await this.prisma.supplierPayment.findMany({
      where: { shopId, purchaseId: id, status: RecordStatus.ACTIVE },
      select: { amount: true },
    });
    let reversed = 0n;
    for (const payment of billPayments) reversed += payment.amount;

    const currentCash = await this.currentCash(this.prisma, shopId);
    const cashAfter = currentCash + Number(reversed);

    let supplierPayableAfter: number | null = null;
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: purchase.supplierId, shopId },
      select: { openingBalance: true },
    });
    if (supplier) {
      const [purchasesAgg, paymentsAgg] = await Promise.all([
        this.prisma.purchase.aggregate({
          where: {
            shopId,
            supplierId: purchase.supplierId,
            status: RecordStatus.ACTIVE,
            isOpeningStock: false,
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.supplierPayment.aggregate({
          where: {
            shopId,
            supplierId: purchase.supplierId,
            status: RecordStatus.ACTIVE,
          },
          _sum: { amount: true },
        }),
      ]);
      const payable =
        Number(supplier.openingBalance) +
        Number(purchasesAgg._sum.totalAmount ?? 0n) -
        Number(paymentsAgg._sum.amount ?? 0n);
      // Opening-stock bills never entered the payable, so removing one
      // changes nothing; every other bill drops out with this cancel.
      supplierPayableAfter =
        payable -
        (purchase.isOpeningStock ? 0 : Number(purchase.totalAmount)) +
        Number(reversed);
    }

    return {
      recordType: 'PURCHASE',
      recordId: purchase.id,
      recordNo: purchase.purchaseNo,
      currentCash,
      cashReversedAmount: Number(reversed),
      cashReversedDirection: 'IN',
      cashAfter,
      willCauseOverdraft: cashAfter < 0,
      customerUdharAfter: null,
      supplierPayableAfter,
      stockItems,
      blocked,
      blockedReason,
    };
  }

  /**
   * The cash row a supplier payment drew from. WF7 payments wrote their own
   * (SUPPLIER_PAYMENT, payment id) row; WF6's paidNow wrote a single
   * (PURCHASE, purchase id) row instead, so fall back to that exactly when
   * the payment has no row of its own. reversesMovementId is UNIQUE, so a
   * second row can never claim the same original twice.
   */
  private async originalSupplierCash(
    tx: Tx,
    shopId: string,
    paymentId: string,
    purchaseId: string,
  ): Promise<{ id: string } | null> {
    const own = await tx.cashMovement.findFirst({
      where: {
        shopId,
        type: CashMovementType.SUPPLIER_PAYMENT,
        referenceType: ReferenceType.SUPPLIER_PAYMENT,
        referenceId: paymentId,
      },
      select: { id: true },
    });
    if (own) return own;

    return tx.cashMovement.findFirst({
      where: {
        shopId,
        type: CashMovementType.SUPPLIER_PAYMENT,
        referenceType: ReferenceType.PURCHASE,
        referenceId: purchaseId,
      },
      select: { id: true },
    });
  }

  async getPurchases(
    query: PurchaseQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponsePurchaseDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'purchaseDate';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.PurchaseWhereInput = { shopId };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;
    if (query.isOpeningStock !== undefined && query.isOpeningStock !== null) {
      where.isOpeningStock = query.isOpeningStock;
    }
    const dateFilters: Prisma.PurchaseWhereInput[] = [];
    if (query.from)
      dateFilters.push({ purchaseDate: { gte: new Date(query.from) } });
    if (query.to)
      dateFilters.push({ purchaseDate: { lte: new Date(query.to) } });
    if (dateFilters.length > 0) where.AND = dateFilters;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { purchaseNo: { contains: term, mode: 'insensitive' } },
        { supplierInvoiceRef: { contains: term, mode: 'insensitive' } },
        { supplier: { name: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: PURCHASE_INCLUDE,
      }),
      this.prisma.purchase.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponsePurchaseDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  async getPurchaseById(
    id: string,
    shopId: string,
  ): Promise<ResponsePurchaseDto> {
    const row = await this.prisma.purchase.findFirst({
      where: { id, shopId },
      include: PURCHASE_INCLUDE,
    });
    if (!row) throw new NotFoundException(resourceNotFound('Purchase', id));
    return this.toResponse(row);
  }

  /**
   * Cross-line checks that need every product: right shop, right tracking
   * type, IMEI count, IMEIs unique inside this request and against the shop's
   * inventory. Runs before any write so a bad line never consumes a number.
   */
  private async validateLines(
    dto: CreatePurchaseDto,
    shopId: string,
  ): Promise<CreatePurchaseDto['items']> {
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

    const seen = new Set<string>();
    for (const line of dto.items) {
      const product = byId.get(line.productId)!;
      const imeis = line.imeis ?? [];

      if (product.trackingType === 'SERIALIZED') {
        if (imeis.length !== line.quantity) {
          throw new BadRequestException(
            imeisCountMismatch(product.name, line.quantity, imeis.length),
          );
        }
      } else if (imeis.length > 0) {
        throw new BadRequestException(imeisNotAllowed(product.name));
      }

      for (const imei of imeis) {
        if (seen.has(imei)) throw new BadRequestException(duplicateImei(imei));
        seen.add(imei);
      }
    }

    if (seen.size > 0) {
      const inUse = await this.prisma.inventoryUnit.findMany({
        where: { shopId, imei1: { in: [...seen] } },
        select: { imei1: true },
      });
      if (inUse.length > 0) {
        throw new BadRequestException(duplicateImei(inUse[0].imei1));
      }
    }

    return dto.items;
  }

  private async insertPurchase(
    tx: Tx,
    dto: CreatePurchaseDto,
    shopId: string,
    userId: string,
    totalAmount: bigint,
  ): Promise<{ id: string }> {
    const rows = await tx.$queryRaw<Array<{ next: number }>>`
      UPDATE shops SET next_purchase_no = next_purchase_no + 1
      WHERE id = ${shopId}
      RETURNING next_purchase_no - 1 AS next
    `;
    if (!rows?.length) {
      throw new NotFoundException(resourceNotFound('Shop', shopId));
    }

    return tx.purchase.create({
      data: {
        shopId,
        supplierId: dto.supplierId,
        purchaseNo: `P-${String(rows[0].next).padStart(4, '0')}`,
        supplierInvoiceRef: dto.supplierInvoiceRef ?? null,
        purchaseDate: new Date(dto.purchaseDate),
        totalAmount,
        isOpeningStock: dto.isOpeningStock ?? false,
        clientRequestId: dto.clientRequestId,
        notes: dto.notes?.trim() ? dto.notes : null,
        createdById: userId,
      },
      select: { id: true },
    });
  }

  /**
   * SERIALIZED → one inventory_units row per IMEI plus a +1 movement each.
   * QUANTITY → upsert stock_levels with a weighted average cost
   * ((40×50000 + 20×60000)/60 ≈ 53333) plus a single +qty movement.
   */
  private async applyStock(
    tx: Tx,
    shopId: string,
    purchaseId: string,
    purchaseItemId: string,
    line: CreatePurchaseDto['items'][number],
  ): Promise<void> {
    const imeis = line.imeis ?? [];

    if (imeis.length > 0) {
      for (const imei of imeis) {
        const unit = await tx.inventoryUnit.create({
          data: {
            shopId,
            productId: line.productId,
            purchaseItemId,
            imei1: imei,
            condition: line.condition ?? UnitCondition.NEW,
            unitCost: BigInt(line.unitCost),
          },
          select: { id: true },
        });
        await tx.inventoryMovement.create({
          data: {
            shopId,
            productId: line.productId,
            inventoryUnitId: unit.id,
            type: InventoryMovementType.PURCHASE,
            quantityChange: 1,
            referenceType: ReferenceType.PURCHASE,
            referenceId: purchaseId,
          },
        });
      }
      return;
    }

    // Read inside the transaction so two lines of the same purchase chain
    // correctly: the second read already sees the first line's write.
    const current = await tx.stockLevel.findUnique({
      where: { productId: line.productId },
    });
    const oldQty = current?.quantityOnHand ?? 0;
    const newQty = oldQty + line.quantity;
    const newAvg = Math.round(
      (oldQty * Number(current?.avgUnitCost ?? 0) +
        line.quantity * line.unitCost) /
        newQty,
    );

    if (current) {
      await tx.stockLevel.update({
        where: { productId: line.productId },
        data: { quantityOnHand: newQty, avgUnitCost: BigInt(newAvg) },
      });
    } else {
      await tx.stockLevel.create({
        data: {
          productId: line.productId,
          shopId,
          quantityOnHand: newQty,
          avgUnitCost: BigInt(newAvg),
        },
      });
    }

    await tx.inventoryMovement.create({
      data: {
        shopId,
        productId: line.productId,
        type: InventoryMovementType.PURCHASE,
        quantityChange: line.quantity,
        referenceType: ReferenceType.PURCHASE,
        referenceId: purchaseId,
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

  private toResponse(row: PurchaseWithLines): ResponsePurchaseDto {
    return {
      id: row.id,
      shopId: row.shopId,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      purchaseNo: row.purchaseNo,
      supplierInvoiceRef: row.supplierInvoiceRef,
      purchaseDate: row.purchaseDate.toISOString().slice(0, 10),
      totalAmount: Number(row.totalAmount),
      isOpeningStock: row.isOpeningStock,
      status: row.status,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      cancelledById: row.cancelledById,
      clientRequestId: row.clientRequestId,
      notes: row.notes,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: row.items.map((item): ResponsePurchaseItemDto => ({
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        totalCost: Number(item.totalCost),
        imeis: item.inventoryUnits.map((unit) => unit.imei1),
      })),
    };
  }
}

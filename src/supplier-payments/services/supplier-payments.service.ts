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
  ReferenceType,
  RecordStatus,
} from '../../generated/prisma/enums.js';
import { CreateSupplierPaymentDto } from '../dto/create-supplier-payment.dto.js';
import { CancelSupplierPaymentDto } from '../dto/cancel-supplier-payment.dto.js';
import { SupplierPaymentQueryFilterDto } from '../dto/supplier-payment-query.filter.js';
import {
  ResponseSupplierPaymentDto,
  SupplierPayableDto,
  UnpaidPurchaseDto,
} from '../dto/response-supplier-payment.dto.js';
import { PurchaseOverdraftResponseDto } from '../../purchases/dto/overdraft-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import { CancelImpactResponseDto } from '../../common-dto/response/cancel-impact.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import {
  cancelledRowMutationForbidden,
  paymentExceedsOutstanding,
  purchaseHasNoPayable,
  purchaseSupplierMismatch,
  resourceNotFound,
} from '../../errors/error.builder.js';

const SUPPLIER_PAYMENT_INCLUDE = {
  supplier: { select: { name: true } },
  purchase: { select: { purchaseNo: true } },
} satisfies Prisma.SupplierPaymentInclude;

type SupplierPaymentWithRefs = Prisma.SupplierPaymentGetPayload<{
  include: typeof SUPPLIER_PAYMENT_INCLUDE;
}>;

export type CreateSupplierPaymentResult =
  StatusBaseResponseDTO | PurchaseOverdraftResponseDto;

type Tx = Prisma.TransactionClient;

const CREATED = 'Supplier payment recorded successfully';
const CANCELLED = 'Supplier payment cancelled successfully';

/**
 * WF7 — Pay a supplier later.
 *
 * Outstanding is always derived, never stored (AGENTS §9): opening balance +
 * active real purchases − active payments. The supplier row is locked with
 * SELECT ... FOR UPDATE at the top of the transaction so two saves racing the
 * same bill cannot both pass the "is it still affordable" check.
 */
@Injectable()
export class SupplierPaymentsService {
  private readonly logger = new Logger(SupplierPaymentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSupplierPayment(
    dto: CreateSupplierPaymentDto,
    shopId: string,
    userId: string,
  ): Promise<CreateSupplierPaymentResult> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, shopId },
      select: { id: true, name: true },
    });
    if (!supplier) {
      throw new NotFoundException(resourceNotFound('Supplier', dto.supplierId));
    }

    const amount = BigInt(dto.amount);

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serialise this shop's cash reads: the currentCash aggregate below is
      // a snapshot of committed rows, so two concurrent payments to different
      // suppliers would each pass the overdraft check on the same balance.
      // Locking the shop row first makes the second writer wait; after the
      // first commits it re-reads the new balance. Lock order is always
      // shop → supplier so two payments can never deadlock.
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      // Serialises payments per supplier: the remaining-outstanding read
      // below only becomes visible after the competing save commits.
      const locked = await tx.$queryRaw<
        Array<{ opening_balance: bigint | string }>
      >`
        SELECT opening_balance FROM suppliers
        WHERE id = ${dto.supplierId} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(
          resourceNotFound('Supplier', dto.supplierId),
        );
      }
      const openingBalance = BigInt(locked[0].opening_balance);

      const remaining = dto.purchaseId
        ? await this.purchaseRemaining(tx, dto, supplier.name, shopId)
        : await this.openingRemaining(
            tx,
            dto.supplierId,
            shopId,
            openingBalance,
          );

      if (amount > remaining) {
        throw new BadRequestException(
          paymentExceedsOutstanding(
            supplier.name,
            Number(amount),
            Number(remaining),
          ),
        );
      }

      let overdraft = false;
      const after = (await this.currentCash(tx, shopId)) - Number(amount);
      if (after < 0) {
        if (!dto.confirmOverdraft) {
          return { kind: 'overdraft' as const, shortfall: -after };
        }
        overdraft = true;
      }

      const payment = await tx.supplierPayment.create({
        data: {
          shopId,
          supplierId: dto.supplierId,
          purchaseId: dto.purchaseId ?? null,
          amount,
          paymentDate: new Date(dto.paymentDate),
          notes: dto.notes?.trim() ? dto.notes : null,
          createdById: userId,
        },
        select: { id: true },
      });

      await tx.cashMovement.create({
        data: {
          shopId,
          type: CashMovementType.SUPPLIER_PAYMENT,
          direction: CashDirection.OUT,
          amount,
          movementDate: new Date(dto.paymentDate),
          referenceType: ReferenceType.SUPPLIER_PAYMENT,
          referenceId: payment.id,
          isOverdraft: overdraft,
          note: dto.notes?.trim() ? dto.notes : null,
          createdById: userId,
        },
      });

      return { kind: 'created' as const };
    });

    if (outcome.kind === 'overdraft') {
      return new PurchaseOverdraftResponseDto(outcome.shortfall);
    }
    return new StatusBaseResponseDTO(true, CREATED);
  }

  /**
   * WF12 — Cancel a supplier payment with reason.
   *
   * One $transaction: lock shop → lock the payment row → mark it CANCELLED
   * with reason/time/user → one cash REVERSAL (IN) pointing back at the
   * original SUPPLIER_PAYMENT movement (falling back to the purchase's
   * paidNow row, which WF6 wrote as PURCHASE + purchase id). The payable
   * comes back automatically because it is derived from ACTIVE rows only.
   * Reversals only add cash, so there is no overdraft prompt.
   */
  async cancelSupplierPayment(
    id: string,
    dto: CancelSupplierPaymentDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // Pre-transaction tenant + existence check so we 404 fast without a lock.
    const payment = await this.prisma.supplierPayment.findFirst({
      where: { id, shopId },
      select: { id: true, status: true, purchaseId: true },
    });
    if (!payment) {
      throw new NotFoundException(resourceNotFound('Supplier payment', id));
    }
    if (payment.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Supplier payment', id),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      // Re-check under the payment row lock: two cancels racing the same
      // payment must not both pass the pre-check (rule 8: cancel once).
      const locked = await tx.$queryRaw<
        Array<{ status: string; amount: bigint | string }>
      >`
        SELECT status, amount FROM supplier_payments
        WHERE id = ${id} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(resourceNotFound('Supplier payment', id));
      }
      if (locked[0].status !== RecordStatus.ACTIVE) {
        throw new BadRequestException(
          cancelledRowMutationForbidden('Supplier payment', id),
        );
      }
      const amount = BigInt(locked[0].amount);

      const original = await this.originalCashMovement(
        tx,
        shopId,
        payment.id,
        payment.purchaseId,
      );
      if (!original) {
        throw new NotFoundException(
          resourceNotFound('Cash movement for supplier payment', id),
        );
      }

      const now = new Date();
      await tx.supplierPayment.update({
        where: { id, shopId },
        data: {
          status: RecordStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: dto.cancelReason,
          cancelledById: userId,
        },
      });

      await tx.cashMovement.create({
        data: {
          shopId,
          type: CashMovementType.REVERSAL,
          direction: CashDirection.IN,
          amount,
          movementDate: now,
          referenceType: ReferenceType.SUPPLIER_PAYMENT,
          referenceId: id,
          reversesMovementId: original.id,
          note: dto.cancelReason,
          createdById: userId,
        },
      });
    });

    return new StatusBaseResponseDTO(true, CANCELLED);
  }

  /**
   * WF12 step 3 — the impact preview for one supplier payment. Read-only
   * twin of cancelSupplierPayment: the cash coming back (IN) with the
   * resulting drawer balance, and the payable after. Never blocked —
   * reversals only add cash, and the payable simply grows by the amount.
   */
  async getCancelImpact(
    id: string,
    shopId: string,
  ): Promise<CancelImpactResponseDto> {
    const payment = await this.prisma.supplierPayment.findFirst({
      where: { id, shopId },
      select: { id: true, status: true, amount: true, supplierId: true },
    });
    if (!payment) {
      throw new NotFoundException(resourceNotFound('Supplier payment', id));
    }
    if (payment.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Supplier payment', id),
      );
    }

    const currentCash = await this.currentCash(this.prisma, shopId);
    const cashAfter = currentCash + Number(payment.amount);

    let supplierPayableAfter: number | null = null;
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: payment.supplierId, shopId },
      select: { openingBalance: true },
    });
    if (supplier) {
      const [purchasesAgg, paymentsAgg] = await Promise.all([
        this.prisma.purchase.aggregate({
          where: {
            shopId,
            supplierId: payment.supplierId,
            status: RecordStatus.ACTIVE,
            isOpeningStock: false,
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.supplierPayment.aggregate({
          where: {
            shopId,
            supplierId: payment.supplierId,
            status: RecordStatus.ACTIVE,
          },
          _sum: { amount: true },
        }),
      ]);
      const payable =
        Number(supplier.openingBalance) +
        Number(purchasesAgg._sum.totalAmount ?? 0n) -
        Number(paymentsAgg._sum.amount ?? 0n);
      // Dropping this payment from the active sum gives the money back.
      supplierPayableAfter = payable + Number(payment.amount);
    }

    return {
      recordType: 'SUPPLIER_PAYMENT',
      recordId: payment.id,
      recordNo: null,
      currentCash,
      cashReversedAmount: Number(payment.amount),
      cashReversedDirection: 'IN',
      cashAfter,
      willCauseOverdraft: cashAfter < 0,
      customerUdharAfter: null,
      supplierPayableAfter,
      stockItems: [],
      blocked: false,
      blockedReason: null,
    };
  }

  /**
   * The cash row this payment drew from. WF7 payments wrote their own
   * (SUPPLIER_PAYMENT, payment id) row; WF6's paidNow wrote a single
   * (PURCHASE, purchase id) row instead, so fall back to that exactly when
   * the payment has no row of its own. reversesMovementId is UNIQUE, so a
   * second row can never claim the same original twice.
   */
  private async originalCashMovement(
    tx: Tx,
    shopId: string,
    paymentId: string,
    purchaseId: string | null,
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
    if (!purchaseId) return null;

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

  async getSupplierPayments(
    query: SupplierPaymentQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseSupplierPaymentDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'paymentDate';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.SupplierPaymentWhereInput = { shopId };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.purchaseId) where.purchaseId = query.purchaseId;
    if (query.status) where.status = query.status;

    const dateFilters: Prisma.SupplierPaymentWhereInput[] = [];
    if (query.from)
      dateFilters.push({ paymentDate: { gte: new Date(query.from) } });
    if (query.to)
      dateFilters.push({ paymentDate: { lte: new Date(query.to) } });
    if (dateFilters.length > 0) where.AND = dateFilters;

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { supplier: { name: { contains: term, mode: 'insensitive' } } },
        { purchase: { purchaseNo: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.supplierPayment.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: SUPPLIER_PAYMENT_INCLUDE,
      }),
      this.prisma.supplierPayment.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseSupplierPaymentDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  /** WF7 steps 1–2: what is owed, and which bills still have room left. */
  async getSupplierPayable(
    supplierId: string,
    shopId: string,
  ): Promise<SupplierPayableDto> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, shopId },
      select: { id: true, name: true, openingBalance: true },
    });
    if (!supplier) {
      throw new NotFoundException(resourceNotFound('Supplier', supplierId));
    }

    const [purchases, payments] = await Promise.all([
      this.prisma.purchase.findMany({
        where: {
          shopId,
          supplierId,
          status: RecordStatus.ACTIVE,
          isOpeningStock: false,
        },
        orderBy: { purchaseDate: 'asc' },
        select: {
          id: true,
          purchaseNo: true,
          supplierInvoiceRef: true,
          purchaseDate: true,
          totalAmount: true,
          supplierPayments: {
            where: { status: RecordStatus.ACTIVE },
            select: { amount: true },
          },
        },
      }),
      this.prisma.supplierPayment.findMany({
        where: { shopId, supplierId, status: RecordStatus.ACTIVE },
        select: { purchaseId: true, amount: true },
      }),
    ]);

    let totalPurchases = 0n;
    let totalPaid = 0n;
    let paidOnOpening = 0n;
    for (const p of purchases) totalPurchases += p.totalAmount;
    for (const pay of payments) {
      totalPaid += pay.amount;
      if (pay.purchaseId === null) paidOnOpening += pay.amount;
    }

    const openingRemaining = supplier.openingBalance - paidOnOpening;
    const unpaid: UnpaidPurchaseDto[] = purchases
      .map((p) => {
        const paidOnBill = p.supplierPayments.reduce(
          (sum, pay) => sum + pay.amount,
          0n,
        );
        return {
          id: p.id,
          purchaseNo: p.purchaseNo,
          supplierInvoiceRef: p.supplierInvoiceRef,
          purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
          totalAmount: Number(p.totalAmount),
          paidAmount: Number(paidOnBill),
          remaining: Number(p.totalAmount - paidOnBill),
        };
      })
      .filter((p) => p.remaining > 0);

    return {
      supplierId: supplier.id,
      supplierName: supplier.name,
      openingBalance: Number(supplier.openingBalance),
      openingRemaining: Number(openingRemaining),
      totalPurchases: Number(totalPurchases),
      totalPaid: Number(totalPaid),
      payable: Number(supplier.openingBalance + totalPurchases - totalPaid),
      unpaidPurchases: unpaid,
    };
  }

  private async purchaseRemaining(
    tx: Tx,
    dto: CreateSupplierPaymentDto,
    supplierName: string,
    shopId: string,
  ): Promise<bigint> {
    const purchase = await tx.purchase.findFirst({
      where: { id: dto.purchaseId!, shopId },
      select: {
        id: true,
        purchaseNo: true,
        supplierId: true,
        totalAmount: true,
        status: true,
        isOpeningStock: true,
      },
    });
    if (!purchase) {
      throw new NotFoundException(
        resourceNotFound('Purchase', dto.purchaseId!),
      );
    }
    if (purchase.supplierId !== dto.supplierId) {
      throw new BadRequestException(
        purchaseSupplierMismatch(purchase.purchaseNo, supplierName),
      );
    }
    if (purchase.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Purchase', purchase.purchaseNo),
      );
    }
    if (purchase.isOpeningStock) {
      throw new BadRequestException(purchaseHasNoPayable(purchase.purchaseNo));
    }

    const paid = await tx.supplierPayment.aggregate({
      where: {
        shopId,
        purchaseId: purchase.id,
        status: RecordStatus.ACTIVE,
      },
      _sum: { amount: true },
    });
    return purchase.totalAmount - (paid._sum.amount ?? 0n);
  }

  private async openingRemaining(
    tx: Tx,
    supplierId: string,
    shopId: string,
    openingBalance: bigint,
  ): Promise<bigint> {
    const paid = await tx.supplierPayment.aggregate({
      where: {
        shopId,
        supplierId,
        purchaseId: null,
        status: RecordStatus.ACTIVE,
      },
      _sum: { amount: true },
    });
    return openingBalance - (paid._sum.amount ?? 0n);
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

  private toResponse(row: SupplierPaymentWithRefs): ResponseSupplierPaymentDto {
    return {
      id: row.id,
      shopId: row.shopId,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      purchaseId: row.purchaseId,
      purchaseNo: row.purchase?.purchaseNo ?? null,
      amount: Number(row.amount),
      paymentDate: row.paymentDate.toISOString().slice(0, 10),
      status: row.status,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      cancelledById: row.cancelledById,
      notes: row.notes,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

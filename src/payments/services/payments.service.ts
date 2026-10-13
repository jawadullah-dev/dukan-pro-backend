import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CashDirection,
  CashMovementType,
  PaymentMethod,
  RecordStatus,
  ReferenceType,
} from '../../generated/prisma/enums.js';
import { CreatePaymentDto } from '../dto/create-payment.dto.js';
import { CancelPaymentDto } from '../dto/cancel-payment.dto.js';
import { PaymentQueryFilterDto } from '../dto/payment-query.filter.js';
import { ResponsePaymentDto } from '../dto/response-payment.dto.js';
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
  duplicateFieldValue,
  paymentExceedsOutstanding,
  resourceNotFound,
} from '../../errors/error.builder.js';
import {
  isUniqueConstraintViolation,
  uniqueViolationColumns,
} from '../../helpers/prisma-error-helper.js';

const PAYMENT_INCLUDE = {
  customer: { select: { name: true } },
  sale: { select: { saleNo: true } },
} satisfies Prisma.PaymentInclude;

type PaymentWithRefs = Prisma.PaymentGetPayload<{
  include: typeof PAYMENT_INCLUDE;
}>;

type Tx = Prisma.TransactionClient;

const CREATED = 'Payment recorded successfully';
const ALREADY_SAVED = 'Payment already saved';
const CANCELLED = 'Payment cancelled successfully';

export type CancelPaymentResult =
  StatusBaseResponseDTO | PurchaseOverdraftResponseDto;

/** A candidate sale for allocation: id and its stored total, both BigInt-safe. */
type CandidateSale = { id: string; totalAmount: bigint };

/**
 * WF10 — Customer Pays Udhar.
 *
 * Outstanding is always derived, never stored (AGENTS rule 4): opening
 * balance + Σ active sales − Σ active payments − Σ returns + Σ refunds
 * (WF15 joined the derivation). The amount is applied
 * oldest-first (opening balance, then sales by date) unless the owner names
 * the sales. One payments row per portion, all sharing one receiptGroupId.
 *
 * Lock order is shop → customer → sale rows (sorted): the customer row is the
 * serialiser for opening-balance-only payments, which touch no sale rows, and
 * sorted sale locks stop two overlapping payments from deadlocking.
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createPayment(
    dto: CreatePaymentDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // Idempotency first: a replayed request answers "already saved" even if
    // master data changed since (AGENTS rule 6), same as WF6/WF9.
    const existing = await this.prisma.payment.findFirst({
      where: { shopId, clientRequestId: dto.clientRequestId },
      select: { id: true },
    });
    if (existing) {
      return new StatusBaseResponseDTO(true, ALREADY_SAVED);
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, shopId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(resourceNotFound('Customer', dto.customerId));
    }

    let explicitIds: string[] | null = null;
    if (dto.salesIds !== undefined) {
      const seen = new Set<string>();
      for (const id of dto.salesIds) {
        if (seen.has(id)) {
          throw new BadRequestException(
            duplicateFieldValue('Payment', 'saleId', id),
          );
        }
        seen.add(id);
      }
      // "Not in this customer's profile" is answered the same as not found —
      // the sale must be an ACTIVE sale of THIS customer in THIS shop.
      const sales = await this.prisma.sale.findMany({
        where: {
          id: { in: dto.salesIds },
          shopId,
          customerId: dto.customerId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (sales.length !== dto.salesIds.length) {
        const found = new Set(sales.map((sale) => sale.id));
        const missing = dto.salesIds.find((id) => !found.has(id))!;
        throw new NotFoundException(resourceNotFound('Sale', missing));
      }
      explicitIds = dto.salesIds;
    }

    const amount = BigInt(dto.amount);
    const paymentMoment = new Date(dto.paymentDate);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const shop = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
        `;
        if (!shop?.length) {
          throw new NotFoundException(resourceNotFound('Shop', shopId));
        }

        const lockedCustomer = await tx.$queryRaw<
          Array<{ name: string; opening_balance: bigint | string }>
        >`
          SELECT name, opening_balance FROM customers
          WHERE id = ${dto.customerId} AND shop_id = ${shopId}
          FOR UPDATE
        `;
        if (!lockedCustomer?.length) {
          throw new NotFoundException(
            resourceNotFound('Customer', dto.customerId),
          );
        }
        const customerName = lockedCustomer[0].name;
        const openingBalance = BigInt(lockedCustomer[0].opening_balance);

        // Replay checked AGAIN under the locks: the expression index
        // payments_idempotency_uq cannot catch a racing duplicate — the same
        // clientRequestId landing on a different sale_id would not collide,
        // and violatedColumn('client_request_id') fails because the index
        // name carries no column token.
        const replayed = await tx.payment.findFirst({
          where: { shopId, clientRequestId: dto.clientRequestId },
          select: { id: true },
        });
        if (replayed) {
          return new StatusBaseResponseDTO(true, ALREADY_SAVED);
        }

        const candidates = explicitIds
          ? await this.lockExplicitSales(
              tx,
              explicitIds,
              shopId,
              dto.customerId,
            )
          : await this.lockOpenSales(tx, shopId, dto.customerId);

        const paidRows = await tx.$queryRaw<
          Array<{ sale_id: string | null; total: bigint | string }>
        >`
          SELECT sale_id, SUM(amount) AS total FROM payments
          WHERE shop_id = ${shopId} AND customer_id = ${dto.customerId}
            AND status = 'ACTIVE'
          GROUP BY sale_id
        `;
        const paidBySale = new Map<string, bigint>();
        let paidOpening = 0n;
        for (const row of paidRows ?? []) {
          const total = BigInt(row.total);
          if (row.sale_id) paidBySale.set(row.sale_id, total);
          else paidOpening = total;
        }
        const openingRemaining =
          openingBalance > paidOpening ? openingBalance - paidOpening : 0n;

        // WF15: returns subtract from what the sale still owes and refunds
        // add back — outstanding = total − returns − payments + refunds.
        // Only the candidate sales matter: returns on other sales never take
        // money off these bills.
        const candidateIds = candidates.map((sale) => sale.id);
        const returnedBySale = new Map<string, bigint>();
        const refundedBySale = new Map<string, bigint>();
        if (candidateIds.length > 0) {
          const returnRows = await tx.saleReturn.groupBy({
            by: ['saleId'],
            where: {
              shopId,
              saleId: { in: candidateIds },
              status: RecordStatus.ACTIVE,
            },
            _sum: { returnAmount: true },
          });
          for (const row of returnRows) {
            returnedBySale.set(row.saleId, row._sum.returnAmount ?? 0n);
          }
          const refundRows = await tx.refund.findMany({
            where: {
              shopId,
              saleReturn: {
                saleId: { in: candidateIds },
                status: RecordStatus.ACTIVE,
              },
            },
            select: {
              amount: true,
              saleReturn: { select: { saleId: true } },
            },
          });
          for (const row of refundRows) {
            const key = row.saleReturn.saleId;
            refundedBySale.set(
              key,
              (refundedBySale.get(key) ?? 0n) + row.amount,
            );
          }
        }

        let total = explicitIds ? 0n : openingRemaining;
        const outstanding = new Map<string, bigint>();
        for (const sale of candidates) {
          const leftRaw =
            sale.totalAmount -
            (returnedBySale.get(sale.id) ?? 0n) -
            (paidBySale.get(sale.id) ?? 0n) +
            (refundedBySale.get(sale.id) ?? 0n);
          // Returns can over-pay a bill back to zero; never below.
          const left = leftRaw > 0n ? leftRaw : 0n;
          outstanding.set(sale.id, left);
          total += left;
        }

        if (amount > total) {
          throw new BadRequestException(
            paymentExceedsOutstanding(
              customerName,
              Number(amount),
              Number(total),
            ),
          );
        }

        // Oldest-first (WF10 step 3): opening balance first, then sales by
        // date. Explicit salesIds skips the opening part entirely. Zero
        // portions are never written (DB CHECK amount > 0).
        const portions: Array<{ saleId: string | null; amount: bigint }> = [];
        let left = amount;
        if (!explicitIds && left > 0n && openingRemaining > 0n) {
          const take = left < openingRemaining ? left : openingRemaining;
          portions.push({ saleId: null, amount: take });
          left -= take;
        }
        for (const sale of candidates) {
          if (left === 0n) break;
          const available = outstanding.get(sale.id)!;
          if (available <= 0n) continue;
          const take = left < available ? left : available;
          portions.push({ saleId: sale.id, amount: take });
          left -= take;
        }

        // receiptGroupId has no DB default — one uuid per request, shared by
        // every row this request writes (the receipt the owner sees).
        const receiptGroupId = randomUUID();
        for (const portion of portions) {
          const payment = await tx.payment.create({
            data: {
              shopId,
              customerId: dto.customerId,
              saleId: portion.saleId,
              receiptGroupId,
              amount: portion.amount,
              paymentDate: paymentMoment,
              method: dto.method ?? PaymentMethod.CASH,
              clientRequestId: dto.clientRequestId,
              notes: dto.notes?.trim() ? dto.notes : null,
              createdById: userId,
            },
            select: { id: true },
          });
          await tx.cashMovement.create({
            data: {
              shopId,
              type: CashMovementType.CUSTOMER_PAYMENT,
              direction: CashDirection.IN,
              amount: portion.amount,
              // The drawer ledger moves on the business day the money was
              // received (WF7 convention), not on "now".
              movementDate: paymentMoment,
              referenceType: ReferenceType.PAYMENT,
              referenceId: payment.id,
              createdById: userId,
            },
          });
        }

        return new StatusBaseResponseDTO(true, CREATED);
      });
    } catch (error) {
      // Two requests raced the same clientRequestId: the loser rolls back and
      // must answer "already saved", not 400 (rule 6). `payments_idempotency_uq`
      // is the only unique index a payment insert can hit (plus the PK), so an
      // undetermined P2002 is that index; a NAMED other index is a different
      // bug and must surface as 500.
      if (isUniqueConstraintViolation(error)) {
        const columns = uniqueViolationColumns(error);
        if (
          columns.length === 0 ||
          columns.includes('payments_idempotency_uq') ||
          columns.includes('client_request_id')
        ) {
          return new StatusBaseResponseDTO(true, ALREADY_SAVED);
        }
      }
      throw error;
    }
  }

  /**
   * WF12 — Cancel a customer payment with reason.
   *
   * One $transaction: lock shop → lock the payment row → mark it CANCELLED
   * with reason/time/user → one cash REVERSAL (OUT) pointing back at the
   * original CUSTOMER_PAYMENT movement. The Udhar comes back automatically
   * because outstanding is derived from ACTIVE rows only. The money goes
   * back to the customer, so cash below zero is a soft overdraft prompt
   * (200, nothing written) confirmed with confirmOverdraft: true.
   */
  async cancelPayment(
    id: string,
    dto: CancelPaymentDto,
    shopId: string,
    userId: string,
  ): Promise<CancelPaymentResult> {
    // Pre-transaction tenant + existence check so we 404 fast without a lock.
    const payment = await this.prisma.payment.findFirst({
      where: { id, shopId },
      select: { id: true, status: true, amount: true },
    });
    if (!payment) {
      throw new NotFoundException(resourceNotFound('Payment', id));
    }
    if (payment.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Payment', id),
      );
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
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
        SELECT status, amount FROM payments
        WHERE id = ${id} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(resourceNotFound('Payment', id));
      }
      if (locked[0].status !== RecordStatus.ACTIVE) {
        throw new BadRequestException(
          cancelledRowMutationForbidden('Payment', id),
        );
      }
      const amount = BigInt(locked[0].amount);

      const original = await tx.cashMovement.findFirst({
        where: {
          shopId,
          type: CashMovementType.CUSTOMER_PAYMENT,
          referenceType: ReferenceType.PAYMENT,
          referenceId: id,
        },
        select: { id: true },
      });
      if (!original) {
        throw new NotFoundException(
          resourceNotFound('Cash movement for payment', id),
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

      const now = new Date();
      await tx.payment.update({
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
          direction: CashDirection.OUT,
          amount,
          movementDate: now,
          referenceType: ReferenceType.PAYMENT,
          referenceId: id,
          reversesMovementId: original.id,
          isOverdraft: overdraft,
          note: dto.cancelReason,
          createdById: userId,
        },
      });

      return { kind: 'cancelled' as const };
    });

    if (outcome.kind === 'overdraft') {
      return new PurchaseOverdraftResponseDto(
        outcome.shortfall,
        'payment cancellation',
      );
    }
    return new StatusBaseResponseDTO(true, CANCELLED);
  }

  /**
   * WF12 step 3 — the impact preview for one customer payment. Read-only
   * twin of cancelPayment: cash that would be reversed (OUT) and the Udhar
   * the owner gets back. Nothing is locked or written.
   */
  async getCancelImpact(
    id: string,
    shopId: string,
  ): Promise<CancelImpactResponseDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, shopId },
      select: { id: true, status: true, amount: true, customerId: true },
    });
    if (!payment) {
      throw new NotFoundException(resourceNotFound('Payment', id));
    }
    if (payment.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Payment', id),
      );
    }

    const currentCash = await this.currentCash(this.prisma, shopId);
    const cashAfter = currentCash - Number(payment.amount);

    let customerUdharAfter: number | null = null;
    if (payment.customerId) {
      const [customer, salesAgg, paymentsAgg] = await Promise.all([
        this.prisma.customer.findFirst({
          where: { id: payment.customerId, shopId },
          select: { openingBalance: true },
        }),
        this.prisma.sale.aggregate({
          where: {
            shopId,
            customerId: payment.customerId,
            status: RecordStatus.ACTIVE,
          },
          _sum: { totalAmount: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            shopId,
            customerId: payment.customerId,
            status: RecordStatus.ACTIVE,
          },
          _sum: { amount: true },
        }),
      ]);
      if (customer) {
        const balance =
          Number(customer.openingBalance) +
          Number(salesAgg._sum.totalAmount ?? 0n) -
          Number(paymentsAgg._sum.amount ?? 0n);
        // Dropping this payment from the active sum gives the money back.
        customerUdharAfter = balance + Number(payment.amount);
      }
    }

    return {
      recordType: 'PAYMENT',
      recordId: payment.id,
      recordNo: null,
      currentCash,
      cashReversedAmount: Number(payment.amount),
      cashReversedDirection: 'OUT',
      cashAfter,
      willCauseOverdraft: cashAfter < 0,
      customerUdharAfter,
      supplierPayableAfter: null,
      stockItems: [],
      blocked: false,
      blockedReason: null,
    };
  }

  async getPayments(
    query: PaymentQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponsePaymentDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'paymentDate';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.PaymentWhereInput = { shopId };
    if (query.customerId) where.customerId = query.customerId;
    if (query.saleId) where.saleId = query.saleId;
    if (query.receiptGroupId) where.receiptGroupId = query.receiptGroupId;
    if (query.status) where.status = query.status;
    const dateFilters: Prisma.PaymentWhereInput[] = [];
    if (query.from)
      dateFilters.push({ paymentDate: { gte: new Date(query.from) } });
    if (query.to)
      dateFilters.push({ paymentDate: { lte: new Date(query.to) } });
    if (dateFilters.length > 0) where.AND = dateFilters;
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        { notes: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: PAYMENT_INCLUDE,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponsePaymentDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  async getPaymentById(
    id: string,
    shopId: string,
  ): Promise<ResponsePaymentDto> {
    const row = await this.prisma.payment.findFirst({
      where: { id, shopId },
      include: PAYMENT_INCLUDE,
    });
    if (!row) throw new NotFoundException(resourceNotFound('Payment', id));
    return this.toResponse(row);
  }

  /**
   * Auto mode: lock every ACTIVE sale of this customer, oldest first. Locking
   * all of them (not just the ones allocation will reach) keeps the lock set
   * deterministic, so two concurrent payments always queue in the same order.
   */
  private async lockOpenSales(
    tx: Tx,
    shopId: string,
    customerId: string,
  ): Promise<CandidateSale[]> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; total_amount: bigint | string }>
    >`
      SELECT id, total_amount FROM sales
      WHERE shop_id = ${shopId} AND customer_id = ${customerId}
        AND status = 'ACTIVE'
      ORDER BY sale_date, id
      FOR UPDATE
    `;
    return (rows ?? []).map((row) => ({
      id: row.id,
      totalAmount: BigInt(row.total_amount),
    }));
  }

  /**
   * Explicit mode: lock the named sales one by one, always in (saleDate, id)
   * order so two overlapping explicit payments acquire the same lock order.
   */
  private async lockExplicitSales(
    tx: Tx,
    ids: string[],
    shopId: string,
    customerId: string,
  ): Promise<CandidateSale[]> {
    const ordered = await tx.sale.findMany({
      where: { id: { in: ids }, shopId, customerId, status: 'ACTIVE' },
      orderBy: [{ saleDate: 'asc' }, { id: 'asc' }],
      select: { id: true, totalAmount: true },
    });
    if (ordered.length !== ids.length) {
      const found = new Set(ordered.map((sale) => sale.id));
      const missing = ids.find((id) => !found.has(id))!;
      throw new NotFoundException(resourceNotFound('Sale', missing));
    }
    for (const sale of ordered) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM sales
        WHERE id = ${sale.id} AND shop_id = ${shopId} AND status = 'ACTIVE'
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(resourceNotFound('Sale', sale.id));
      }
    }
    return ordered.map((sale) => ({
      id: sale.id,
      totalAmount: sale.totalAmount,
    }));
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

  private toResponse(row: PaymentWithRefs): ResponsePaymentDto {
    return {
      id: row.id,
      shopId: row.shopId,
      customerId: row.customerId,
      customerName: row.customer?.name,
      saleId: row.saleId,
      saleNo: row.sale?.saleNo ?? null,
      receiptGroupId: row.receiptGroupId,
      amount: Number(row.amount),
      paymentDate: row.paymentDate,
      method: row.method,
      status: row.status,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      cancelledById: row.cancelledById,
      clientRequestId: row.clientRequestId,
      notes: row.notes,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

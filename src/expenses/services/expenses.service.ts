import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CashDirection,
  CashMovementType,
  RecordStatus,
  ReferenceType,
} from '../../generated/prisma/enums.js';
import { CreateExpenseDto } from '../dto/create-expense.dto.js';
import { CancelExpenseDto } from '../dto/cancel-expense.dto.js';
import { ExpenseQueryFilterDto } from '../dto/expense-query.filter.js';
import { ResponseExpenseDto } from '../dto/response-expense.dto.js';
import { PurchaseOverdraftResponseDto } from '../../purchases/dto/overdraft-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import {
  cancelledRowMutationForbidden,
  resourceNotFound,
} from '../../errors/error.builder.js';

const EXPENSE_INCLUDE = {
  category: { select: { name: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseWithCategory = Prisma.ExpenseGetPayload<{
  include: typeof EXPENSE_INCLUDE;
}>;

export type CreateExpenseResult =
  StatusBaseResponseDTO | PurchaseOverdraftResponseDto;

type Tx = Prisma.TransactionClient;

const CREATED = 'Expense recorded successfully';
const CANCELLED = 'Expense cancelled successfully';

/**
 * WF13 — Add & Cancel an Expense.
 *
 * Create: one $transaction — lock shop row → overdraft check → insert expense
 * (ACTIVE) → insert cash_movements (EXPENSE, OUT). Cash below zero is a soft
 * warning (200 prompt) not a hard block; retry with confirmOverdraft: true
 * saves with isOverdraft: true.
 *
 * Cancel: one $transaction — lock shop row → assert ACTIVE → set CANCELLED
 * with reason/time/user → insert cash_movements REVERSAL (IN) pointing back
 * to the original movement via reversesMovementId.
 */
@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createExpense(
    dto: CreateExpenseDto,
    shopId: string,
    userId: string,
  ): Promise<CreateExpenseResult> {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: dto.categoryId, shopId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException(
        resourceNotFound('Expense category', dto.categoryId),
      );
    }

    const amount = BigInt(dto.amount);

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Lock the shop row first so the currentCash aggregate below is
      // serialised against every other concurrent cash writer in this shop
      // (purchases, supplier payments, other expenses). Without this lock two
      // concurrent expenses would each snapshot the same drawer balance and
      // both pass the soft overdraft check on the same stale number.
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      let overdraft = false;
      const after = (await this.currentCash(tx, shopId)) - Number(amount);
      if (after < 0) {
        if (!dto.confirmOverdraft) {
          return { kind: 'overdraft' as const, shortfall: -after };
        }
        overdraft = true;
      }

      const expense = await tx.expense.create({
        data: {
          shopId,
          categoryId: dto.categoryId,
          amount,
          expenseDate: new Date(dto.expenseDate),
          description: dto.description?.trim() ? dto.description : null,
          createdById: userId,
        },
        select: { id: true },
      });

      await tx.cashMovement.create({
        data: {
          shopId,
          type: CashMovementType.EXPENSE,
          direction: CashDirection.OUT,
          amount,
          movementDate: new Date(dto.expenseDate),
          referenceType: ReferenceType.EXPENSE,
          referenceId: expense.id,
          isOverdraft: overdraft,
          createdById: userId,
        },
      });

      return { kind: 'created' as const };
    });

    if (outcome.kind === 'overdraft') {
      return new PurchaseOverdraftResponseDto(outcome.shortfall, 'expense');
    }
    return new StatusBaseResponseDTO(true, CREATED);
  }

  async cancelExpense(
    id: string,
    dto: CancelExpenseDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // Pre-transaction tenant + existence check so we 404 fast without
    // acquiring any lock.
    const expense = await this.prisma.expense.findFirst({
      where: { id, shopId },
      select: { id: true, status: true, amount: true },
    });
    if (!expense) {
      throw new NotFoundException(resourceNotFound('Expense', id));
    }
    if (expense.status === RecordStatus.CANCELLED) {
      throw new BadRequestException(
        cancelledRowMutationForbidden('Expense', id),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Lock shop row before touching cash — same reason as createExpense.
      // A reversal adds cash (IN) so it cannot cause an overdraft, but the
      // lock still serialises the ledger so the running balance stays correct.
      await tx.$queryRaw`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;

      // Re-check under the expense row lock: two cancels racing the same
      // expense must not both pass the pre-check above — the loser gets 400
      // here instead of a duplicate REVERSAL hitting the unique
      // reverses_movement_id index with a 500 (same pattern as WF12).
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM expenses
        WHERE id = ${id} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(resourceNotFound('Expense', id));
      }
      if (locked[0].status !== RecordStatus.ACTIVE) {
        throw new BadRequestException(
          cancelledRowMutationForbidden('Expense', id),
        );
      }

      const now = new Date();

      await tx.expense.update({
        where: { id, shopId },
        data: {
          status: RecordStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: dto.cancelReason,
          cancelledById: userId,
        },
      });

      // Find the original EXPENSE cash movement so the REVERSAL row can
      // point back to it via reversesMovementId (append-only ledger rule).
      // Missing here means the ledger is inconsistent — roll back rather
      // than let cash_movements_reversal_chk reject with a cryptic 500.
      const original = await tx.cashMovement.findFirst({
        where: {
          shopId,
          referenceType: ReferenceType.EXPENSE,
          referenceId: id,
          type: CashMovementType.EXPENSE,
        },
        select: { id: true },
      });
      if (!original) {
        throw new NotFoundException(
          resourceNotFound('Cash movement for expense', id),
        );
      }

      await tx.cashMovement.create({
        data: {
          shopId,
          type: CashMovementType.REVERSAL,
          direction: CashDirection.IN,
          amount: expense.amount,
          movementDate: now,
          referenceType: ReferenceType.EXPENSE,
          referenceId: id,
          reversesMovementId: original.id,
          note: dto.cancelReason,
          createdById: userId,
        },
      });
    });

    return new StatusBaseResponseDTO(true, CANCELLED);
  }

  async getExpenses(
    query: ExpenseQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseExpenseDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'expenseDate';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.ExpenseWhereInput = { shopId };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.status) where.status = query.status;

    const dateFilters: Prisma.ExpenseWhereInput[] = [];
    if (query.from)
      dateFilters.push({ expenseDate: { gte: new Date(query.from) } });
    if (query.to)
      dateFilters.push({ expenseDate: { lte: new Date(query.to) } });
    if (dateFilters.length > 0) where.AND = dateFilters;

    if (query.search?.trim()) {
      where.description = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: EXPENSE_INCLUDE,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseExpenseDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  async getExpenseById(
    id: string,
    shopId: string,
  ): Promise<ResponseExpenseDto> {
    const row = await this.prisma.expense.findFirst({
      where: { id, shopId },
      include: EXPENSE_INCLUDE,
    });
    if (!row) throw new NotFoundException(resourceNotFound('Expense', id));
    return this.toResponse(row);
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

  private toResponse(row: ExpenseWithCategory): ResponseExpenseDto {
    return {
      id: row.id,
      shopId: row.shopId,
      categoryId: row.categoryId,
      categoryName: row.category.name,
      amount: Number(row.amount),
      expenseDate: row.expenseDate.toISOString().slice(0, 10),
      description: row.description,
      status: row.status,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      cancelledById: row.cancelledById,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

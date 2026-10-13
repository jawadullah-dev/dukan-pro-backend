import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma, CashMovement } from '../../generated/prisma/client.js';
import {
  CashDirection,
  CashMovementType,
} from '../../generated/prisma/enums.js';
import { CreateOpeningCashDto } from '../dto/create-opening-cash.dto.js';
import { CreateOwnerInvestmentDto } from '../dto/create-owner-investment.dto.js';
import { CreateOwnerWithdrawalDto } from '../dto/create-owner-withdrawal.dto.js';
import { CashMovementQueryFilterDto } from '../dto/cash-movement-query.filter.js';
import { ResponseCashMovementDto } from '../dto/response-cash-movement.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import { PurchaseOverdraftResponseDto } from '../../purchases/dto/overdraft-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { businessDayRange, businessToday } from '../../helpers/date.helper.js';
import {
  openingCashAlreadySet,
  resourceNotFound,
} from '../../errors/error.builder.js';

const CREATED = 'Opening cash recorded successfully';
const INVESTED = 'Owner investment recorded successfully';
const WITHDRAWN = 'Owner withdrawal recorded successfully';

type Tx = Prisma.TransactionClient;

export type OwnerWithdrawalResult =
  StatusBaseResponseDTO | PurchaseOverdraftResponseDto;

/**
 * WF1 (opening cash) + WF16 (owner investment/withdrawal) + the drill-through
 * list behind the dashboard's cashPosition number.
 *
 * Opening cash is Day-0 data: one OPENING_CASH (IN) row in the append-only
 * cash ledger, settable exactly once per shop. The check runs under the shop
 * row lock so a double-tap cannot write two opening rows.
 *
 * Owner investment (OWNER_INVESTMENT, IN) and withdrawal (OWNER_WITHDRAWAL,
 * OUT) are the shop owner moving their own money in and out. They are kept
 * out of sales and expenses so profit never moves — no module reads these
 * types. A withdrawal follows the soft-overdraft dance (200 prompt, retry
 * with confirmOverdraft: true) exactly like purchases/expenses, so the shop
 * row is locked before the currentCash() aggregate against a TOCTOU race.
 *
 * Cash movements are never updated or deleted — corrections are REVERSAL
 * rows (WF12).
 */
@Injectable()
export class CashService {
  private readonly logger = new Logger(CashService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createOpeningCash(
    dto: CreateOpeningCashDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const amount = BigInt(dto.amount);
    const movementDate = new Date(dto.date ?? businessToday());
    const note = dto.notes?.trim() ? dto.notes : null;

    await this.prisma.$transaction(async (tx) => {
      // Lock the shop row first: two concurrent opening-cash requests
      // serialise here, so the loser sees the winner's row and gets a 400
      // instead of both passing a stale "not set yet" check.
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      const existing = await tx.cashMovement.findFirst({
        where: { shopId, type: CashMovementType.OPENING_CASH },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(openingCashAlreadySet());
      }

      await tx.cashMovement.create({
        data: {
          shopId,
          type: CashMovementType.OPENING_CASH,
          direction: CashDirection.IN,
          amount,
          movementDate,
          note,
          createdById: userId,
        },
      });
    });

    return new StatusBaseResponseDTO(true, CREATED);
  }

  /**
   * WF16 — owner puts their own money into the drawer. One OWNER_INVESTMENT
   * (IN) row; a single insert is its own atomic action (cash only rises, so
   * there is no balance read to serialise). Never counted as revenue.
   */
  async createOwnerInvestment(
    dto: CreateOwnerInvestmentDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    await this.prisma.cashMovement.create({
      data: {
        shopId,
        type: CashMovementType.OWNER_INVESTMENT,
        direction: CashDirection.IN,
        amount: BigInt(dto.amount),
        movementDate: new Date(dto.date ?? businessToday()),
        note: dto.notes?.trim() ? dto.notes : null,
        createdById: userId,
      },
    });

    return new StatusBaseResponseDTO(true, INVESTED);
  }

  /**
   * WF16 — owner takes their own money out. One OWNER_WITHDRAWAL (OUT) row.
   * The shop row is locked before the cash aggregate so two concurrent
   * writers cannot both pass the soft-overdraft prompt on the same balance;
   * the prompt itself is a 200 with nothing written (exact same dance as
   * purchases/expenses). Never counted as an operating expense.
   */
  async createOwnerWithdrawal(
    dto: CreateOwnerWithdrawalDto,
    shopId: string,
    userId: string,
  ): Promise<OwnerWithdrawalResult> {
    const amount = BigInt(dto.amount);

    const outcome = await this.prisma.$transaction(async (tx) => {
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

      await tx.cashMovement.create({
        data: {
          shopId,
          type: CashMovementType.OWNER_WITHDRAWAL,
          direction: CashDirection.OUT,
          amount,
          movementDate: new Date(dto.date ?? businessToday()),
          note: dto.notes?.trim() ? dto.notes : null,
          isOverdraft: overdraft,
          createdById: userId,
        },
      });

      return { kind: 'created' as const };
    });

    if (outcome.kind === 'overdraft') {
      return new PurchaseOverdraftResponseDto(outcome.shortfall, 'withdrawal');
    }
    return new StatusBaseResponseDTO(true, WITHDRAWN);
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

  async getCashMovements(
    query: CashMovementQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseCashMovementDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'movementDate';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.CashMovementWhereInput = { shopId };
    if (query.type) where.type = query.type;
    if (query.direction) where.direction = query.direction;

    const dateFilters: Prisma.CashMovementWhereInput[] = [];
    if (query.from)
      dateFilters.push({
        movementDate: { gte: businessDayRange(query.from).start },
      });
    if (query.to)
      dateFilters.push({
        movementDate: { lt: businessDayRange(query.to).end },
      });
    if (dateFilters.length > 0) where.AND = dateFilters;

    if (query.search?.trim()) {
      where.note = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.cashMovement.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.cashMovement.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseCashMovementDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  private toResponse(row: CashMovement): ResponseCashMovementDto {
    return {
      id: row.id,
      shopId: row.shopId,
      type: row.type,
      direction: row.direction,
      amount: Number(row.amount),
      movementDate: row.movementDate.toISOString(),
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      reversesMovementId: row.reversesMovementId,
      isOverdraft: row.isOverdraft,
      note: row.note,
      createdById: row.createdById,
      createdAt: row.createdAt,
    };
  }
}

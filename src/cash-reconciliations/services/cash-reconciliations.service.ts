import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CashReconciliation, Prisma } from '../../generated/prisma/client.js';
import {
  CashDirection,
  CashMovementType,
  ReferenceType,
} from '../../generated/prisma/enums.js';
import { CreateCashReconciliationDto } from '../dto/create-cash-reconciliation.dto.js';
import { CashReconciliationQueryFilterDto } from '../dto/cash-reconciliation-query.filter.js';
import { ResponseCashReconciliationDto } from '../dto/response-cash-reconciliation.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { businessDayRange, businessToday } from '../../helpers/date.helper.js';
import {
  cashReconciliationReasonRequired,
  resourceNotFound,
} from '../../errors/error.builder.js';

const CREATED = 'Cash reconciliation recorded successfully';

type Tx = Prisma.TransactionClient;

/**
 * WF17 — Cash Count (Reconciliation).
 *
 * The owner compares the system's cash (SUM(IN) − SUM(OUT) over the append-only
 * cash ledger) with what is really in the drawer. A reconciliation row records
 * system, counted and the difference; every non-zero difference writes one
 * RECONCILIATION_ADJUSTMENT cash movement (IN when the drawer has more than the
 * system says, OUT when it has less) so system cash lands exactly on counted.
 *
 * Old cash rows are never edited — the adjustment is a new ledger row, exactly
 * like a REVERSAL. A reason is required whenever the difference is not zero
 * (checked here, and backstopped by cash_recon_reason_chk). A matching count
 * still records a row (a permanent record of the count) but writes no movement —
 * cash_movements_amount_chk forbids amount 0, and there is nothing to adjust.
 */
@Injectable()
export class CashReconciliationsService {
  private readonly logger = new Logger(CashReconciliationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createReconciliation(
    dto: CreateCashReconciliationDto,
    shopId: string,
    userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const reason = dto.reason?.trim() ? dto.reason : null;

    await this.prisma.$transaction(async (tx) => {
      // Serialise the currentCash() read: two concurrent counts must not both
      // snapshot the same balance before the first one's adjustment commits
      // (the WF6/WF7/expense shop-row-lock trick).
      const shop = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shops WHERE id = ${shopId} FOR UPDATE
      `;
      if (!shop?.length) {
        throw new NotFoundException(resourceNotFound('Shop', shopId));
      }

      const countedCash = BigInt(dto.countedCash);
      const systemCash = BigInt(await this.currentCash(tx, shopId));
      const difference = countedCash - systemCash;

      if (difference !== 0n && !reason) {
        throw new BadRequestException(cashReconciliationReasonRequired());
      }

      const reconciliation = await tx.cashReconciliation.create({
        data: {
          shopId,
          systemCash,
          countedCash,
          difference,
          reason,
          createdById: userId,
        },
        select: { id: true },
      });

      if (difference !== 0n) {
        const absolute = difference < 0n ? -difference : difference;
        await tx.cashMovement.create({
          data: {
            shopId,
            type: CashMovementType.RECONCILIATION_ADJUSTMENT,
            direction: difference > 0n ? CashDirection.IN : CashDirection.OUT,
            amount: absolute,
            movementDate: new Date(businessToday()),
            referenceType: ReferenceType.RECONCILIATION,
            referenceId: reconciliation.id,
            createdById: userId,
          },
        });
      }
    });

    return new StatusBaseResponseDTO(true, CREATED);
  }

  async getReconciliations(
    query: CashReconciliationQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseCashReconciliationDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'reconciledAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.CashReconciliationWhereInput = { shopId };
    if (query.search?.trim()) {
      where.reason = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }
    const dateFilters: Prisma.CashReconciliationWhereInput[] = [];
    if (query.from)
      dateFilters.push({
        reconciledAt: { gte: businessDayRange(query.from).start },
      });
    if (query.to)
      dateFilters.push({
        reconciledAt: { lt: businessDayRange(query.to).end },
      });
    if (dateFilters.length > 0) where.AND = dateFilters;

    const [rows, total] = await Promise.all([
      this.prisma.cashReconciliation.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.cashReconciliation.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseCashReconciliationDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  async getReconciliationById(
    id: string,
    shopId: string,
  ): Promise<ResponseCashReconciliationDto> {
    const row = await this.prisma.cashReconciliation.findFirst({
      where: { id, shopId },
    });
    if (!row)
      throw new NotFoundException(resourceNotFound('Reconciliation', id));
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

  private toResponse(row: CashReconciliation): ResponseCashReconciliationDto {
    return {
      id: row.id,
      shopId: row.shopId,
      systemCash: Number(row.systemCash),
      countedCash: Number(row.countedCash),
      difference: Number(row.difference),
      reason: row.reason,
      reconciledAt: row.reconciledAt,
      createdById: row.createdById,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  InventoryMovementType,
  UnitStatus,
} from '../../generated/prisma/enums.js';
import { CreateInventoryAdjustmentDto } from '../dto/create-inventory-adjustment.dto.js';
import { InventoryAdjustmentQueryFilterDto } from '../dto/inventory-adjustment-query.filter.js';
import { ResponseInventoryMovementDto } from '../dto/response-inventory-movement.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import {
  adjustmentNotAllowedForSerialized,
  countedQuantityRequired,
  insufficientStock,
  quantityRequired,
  resourceNotFound,
  unitIdRequired,
  unitNotInStock,
  unwantedAdjustmentField,
} from '../../errors/error.builder.js';

const CREATED = 'Stock change recorded successfully';
const NO_CHANGE = 'Counted matches the system — no change recorded';

export type InventoryAdjustmentOutcome =
  { kind: 'created'; message: string } | { kind: 'nochange'; message: string };

const MOVEMENT_INCLUDE = {
  product: { select: { name: true } },
  inventoryUnit: { select: { imei1: true } },
} satisfies Prisma.InventoryMovementInclude;

type MovementWithRefs = Prisma.InventoryMovementGetPayload<{
  include: typeof MOVEMENT_INCLUDE;
}>;

const MANUAL_TYPES: InventoryMovementType[] = [
  InventoryMovementType.ADJUSTMENT,
  InventoryMovementType.DAMAGED,
  InventoryMovementType.LOST,
];

/**
 * WF8 — Stock adjustment, damaged and lost.
 *
 * One change = one `$transaction`: append one row to the append-only
 * `inventory_movements` ledger (the DB trigger blocks edit/delete) and move
 * the current-value row (stock_levels for accessories, the unit's status for
 * phones). ACCESSORIES: ADJUSTMENT sets the shelf count to the typed number
 * and stores counted − system; DAMAGED/LOST subtracts atomically and can
 * never drive the count below zero. PHONES: DAMAGED/LOST flips one IN_STOCK
 * unit's status so it can never be sold. reason is mandatory for all three.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async createAdjustment(
    dto: CreateInventoryAdjustmentDto,
    shopId: string,
  ): Promise<InventoryAdjustmentOutcome> {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, shopId, isActive: true },
      select: { id: true, name: true, trackingType: true },
    });
    if (!product) {
      throw new NotFoundException(resourceNotFound('Product', dto.productId));
    }

    this.assertShape(product, dto);

    if (dto.type === 'ADJUSTMENT') {
      return this.adjustStock(
        product,
        dto.countedQuantity!,
        dto.reason,
        shopId,
      );
    }
    if (product.trackingType === 'SERIALIZED') {
      return this.damagePhone(product, dto, shopId);
    }
    return this.damageQuantity(
      product,
      dto.quantity!,
      dto.type,
      dto.reason,
      shopId,
    );
  }

  /**
   * Field/type shape rules per product kind — run before any write. Wrong
   * shape → 400 with the exact field to fix, nothing touched inside the tx.
   */
  private assertShape(
    product: { name: string; trackingType: string },
    dto: CreateInventoryAdjustmentDto,
  ): void {
    if (dto.type === 'ADJUSTMENT') {
      if (product.trackingType === 'SERIALIZED') {
        throw new BadRequestException(
          adjustmentNotAllowedForSerialized(product.name),
        );
      }
      if (dto.countedQuantity === undefined) {
        throw new BadRequestException(countedQuantityRequired(product.name));
      }
      if (dto.quantity !== undefined) {
        throw new BadRequestException(
          unwantedAdjustmentField(product.name, 'ADJUSTMENT', 'quantity'),
        );
      }
      if (dto.inventoryUnitId !== undefined) {
        throw new BadRequestException(
          unwantedAdjustmentField(
            product.name,
            'ADJUSTMENT',
            'inventoryUnitId',
          ),
        );
      }
      return;
    }

    // DAMAGED / LOST.
    if (product.trackingType === 'SERIALIZED') {
      if (dto.inventoryUnitId === undefined) {
        throw new BadRequestException(unitIdRequired(product.name));
      }
      if (dto.quantity !== undefined) {
        throw new BadRequestException(
          unwantedAdjustmentField(product.name, dto.type, 'quantity'),
        );
      }
      if (dto.countedQuantity !== undefined) {
        throw new BadRequestException(
          unwantedAdjustmentField(product.name, dto.type, 'countedQuantity'),
        );
      }
      return;
    }

    // QUANTITY + DAMAGED/LOST.
    if (dto.quantity === undefined) {
      throw new BadRequestException(quantityRequired(product.name));
    }
    if (dto.countedQuantity !== undefined) {
      throw new BadRequestException(
        unwantedAdjustmentField(product.name, dto.type, 'countedQuantity'),
      );
    }
    if (dto.inventoryUnitId !== undefined) {
      throw new BadRequestException(
        unwantedAdjustmentField(product.name, dto.type, 'inventoryUnitId'),
      );
    }
  }

  /**
   * Accessory ADJUSTMENT: count is absolute. The stock row is locked
   * SELECT ... FOR UPDATE so two concurrent adjustments to the same product
   * serialize and each records a delta against the row it actually changed.
   * delta === 0 (the count matched) writes nothing — the DB bans
   * quantity_change = 0, and no change needs no ledger entry.
   */
  private async adjustStock(
    product: { id: string; name: string },
    countedQuantity: number,
    reason: string,
    shopId: string,
  ): Promise<InventoryAdjustmentOutcome> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ quantity_on_hand: number }>>`
        SELECT quantity_on_hand FROM stock_levels
        WHERE product_id = ${product.id} AND shop_id = ${shopId}
        FOR UPDATE
      `;
      const currentQty = rows[0]?.quantity_on_hand ?? 0;
      const delta = countedQuantity - currentQty;
      if (delta === 0) return { kind: 'nochange' as const };

      if (rows.length > 0) {
        await tx.stockLevel.update({
          where: { productId: product.id },
          data: { quantityOnHand: countedQuantity },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            productId: product.id,
            shopId,
            quantityOnHand: countedQuantity,
            avgUnitCost: 0n,
          },
        });
      }

      await tx.inventoryMovement.create({
        data: {
          shopId,
          productId: product.id,
          type: InventoryMovementType.ADJUSTMENT,
          quantityChange: delta,
          reason,
        },
      });
      return { kind: 'created' as const };
    });

    return outcome.kind === 'created'
      ? { kind: 'created', message: CREATED }
      : { kind: 'nochange', message: NO_CHANGE };
  }

  /**
   * Accessory DAMAGED/LOST: subtract atomically. The conditional UPDATE lets
   * PostgreSQL be the referee — a concurrent writer cannot double-consume the
   * same units because `quantity_on_hand >= quantity` is tested under the row
   * lock. Zero rows updated = not enough left; read the real number for the
   * message.
   */
  private async damageQuantity(
    product: { id: string; name: string },
    quantity: number,
    type: 'DAMAGED' | 'LOST',
    reason: string,
    shopId: string,
  ): Promise<InventoryAdjustmentOutcome> {
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.$executeRaw`
        UPDATE stock_levels
        SET quantity_on_hand = quantity_on_hand - ${quantity}, updated_at = now()
        WHERE product_id = ${product.id} AND shop_id = ${shopId}
          AND quantity_on_hand >= ${quantity}
      `;
      if (removed === 0) {
        const current = await tx.stockLevel.findUnique({
          where: { productId: product.id },
          select: { quantityOnHand: true },
        });
        throw new BadRequestException(
          insufficientStock(
            product.name,
            current?.quantityOnHand ?? 0,
            quantity,
          ),
        );
      }

      await tx.inventoryMovement.create({
        data: {
          shopId,
          productId: product.id,
          type,
          quantityChange: -quantity,
          reason,
        },
      });
      return { kind: 'created' as const };
    });

    return { kind: 'created', message: CREATED };
  }

  /**
   * Phone DAMAGED/LOST: one IN_STOCK unit flips its status so it can never be
   * sold. The unit row is locked FOR UPDATE — the status check runs under the
   * lock, so two concurrent attempts on the same phone cannot both pass.
   */
  private async damagePhone(
    product: { id: string; name: string },
    dto: CreateInventoryAdjustmentDto,
    shopId: string,
  ): Promise<InventoryAdjustmentOutcome> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string; imei1: string }>
      >`
        SELECT id, status, imei1 FROM inventory_units
        WHERE id = ${dto.inventoryUnitId} AND shop_id = ${shopId}
          AND product_id = ${product.id}
        FOR UPDATE
      `;
      if (!locked?.length) {
        throw new NotFoundException(
          resourceNotFound('Inventory unit', dto.inventoryUnitId),
        );
      }
      const unit = locked[0];
      if (unit.status !== UnitStatus.IN_STOCK) {
        throw new BadRequestException(
          unitNotInStock(product.name, unit.imei1, unit.status),
        );
      }

      const status =
        dto.type === 'DAMAGED' ? UnitStatus.DAMAGED : UnitStatus.LOST;
      await tx.inventoryUnit.update({
        where: { id: unit.id },
        data: { status },
      });
      await tx.inventoryMovement.create({
        data: {
          shopId,
          productId: product.id,
          inventoryUnitId: unit.id,
          type: dto.type,
          quantityChange: -1,
          reason: dto.reason,
        },
      });
      return { kind: 'created' as const };
    });

    return { kind: 'created', message: CREATED };
  }

  async getInventoryMovements(
    query: InventoryAdjustmentQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseInventoryMovementDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.InventoryMovementWhereInput = { shopId };
    // Manual stock changes only by default — purchase/sale movements belong
    // to the ledger (WF11), not to this write-off screen.
    where.type = query.type ?? { in: MANUAL_TYPES };
    if (query.productId) where.productId = query.productId;

    const dateFilters: Prisma.InventoryMovementWhereInput[] = [];
    if (query.from)
      dateFilters.push({ createdAt: { gte: new Date(query.from) } });
    if (query.to) dateFilters.push({ createdAt: { lte: new Date(query.to) } });
    if (dateFilters.length > 0) where.AND = dateFilters;

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { product: { name: { contains: term, mode: 'insensitive' } } },
        { reason: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: MOVEMENT_INCLUDE,
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseInventoryMovementDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  private toResponse(row: MovementWithRefs): ResponseInventoryMovementDto {
    return {
      id: row.id,
      shopId: row.shopId,
      productId: row.productId,
      productName: row.product.name,
      inventoryUnitId: row.inventoryUnitId,
      imei: row.inventoryUnit?.imei1 ?? null,
      type: row.type,
      quantityChange: row.quantityChange,
      reason: row.reason,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      createdAt: row.createdAt,
    };
  }
}

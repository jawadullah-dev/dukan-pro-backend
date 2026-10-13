import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * WF8 — one stock change, three flavours.
 *
 * The service decides which fields are legal from the product's trackingType:
 * QUANTITY (accessories) use countedQuantity / quantity, SERIALIZED (phones)
 * use inventoryUnitId. Sending a field the product kind does not use is a 400
 * (forbidNonWhitelisted already blocks unknown keys; these are known keys on
 * the wrong shape).
 */
export class CreateInventoryAdjustmentDto {
  @ApiProperty({
    description: 'The product whose stock changed. Must belong to this shop.',
    example: '01924f0a-0000-7000-8000-000000000101',
  })
  @IsUUID()
  productId: string;

  @ApiProperty({
    description:
      'ADJUSTMENT = the shelf count was wrong (accessories only). DAMAGED / LOST = goods written off because they broke or went missing (accessories by quantity, phones by unit).',
    example: 'ADJUSTMENT',
  })
  @IsIn(['ADJUSTMENT', 'DAMAGED', 'LOST'] as const)
  type: 'ADJUSTMENT' | 'DAMAGED' | 'LOST';

  @ApiProperty({
    description:
      'Mandatory for all three types — a stock change with no "why" is a lie in the ledger.',
    example: 'Counting difference at the end of the day',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000, {
    message: 'A non-empty reason is required for every stock change.',
  })
  reason: string;

  @ApiPropertyOptional({
    description:
      'ADJUSTMENT only, QUANTITY products only. The real counted quantity on the shelf (0 is legal — an empty shelf is a real count). The movement records counted − system, so the sign comes from the difference.',
    example: 35,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  countedQuantity?: number;

  @ApiPropertyOptional({
    description:
      'DAMAGED / LOST only, QUANTITY products only. How many units are being written off (applied as a subtraction).',
    example: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quantity?: number;

  @ApiPropertyOptional({
    description:
      'DAMAGED / LOST only, SERIALIZED products only. One phone unit to mark damaged or lost. Must be IN_STOCK, belong to this shop and to the product.',
    example: '01924f0a-0000-7000-8000-0000000000d1',
  })
  @IsOptional()
  @IsUUID()
  inventoryUnitId?: string;
}

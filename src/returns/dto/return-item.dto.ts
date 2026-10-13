import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * One line of a return. Nested inside CreateReturnDto /
 * ReturnPreviewDto with @Type(() => ReturnItemDto) so class-validator
 * actually walks the children.
 *
 * The line is named by its sale line (saleItemId), never by product: a sale
 * can carry the same product on several lines, and a phone line is one unit.
 */
export class ReturnItemDto {
  @ApiProperty({
    description:
      'The sale line being returned. Every id must belong to the sale in the URL — 404 otherwise. Find these ids (with IMEI and already-returned quantities) on GET /sales/{id}.',
    example: '01924f0a-0000-7000-8000-000000000201',
  })
  @IsUUID()
  saleItemId: string;

  @ApiPropertyOptional({
    description:
      'How many units of this line are returned. REQUIRED on quantity-tracked lines; omit (or send 1) on a phone line — one IMEI is one unit.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quantity?: number;

  @ApiProperty({
    description:
      'GOOD goes back on the shelf and becomes sellable again. DAMAGED does not — it is taken back off the shelf immediately (phones become DAMAGED units, accessories get a write-off movement).',
    enum: ['GOOD', 'DAMAGED'],
    example: 'GOOD',
  })
  @IsIn(['GOOD', 'DAMAGED'])
  condition: 'GOOD' | 'DAMAGED';
}

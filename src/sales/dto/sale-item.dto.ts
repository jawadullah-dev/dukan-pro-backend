import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * One line of a sale. Nested inside CreateSaleDto with
 * @Type(() => SaleItemDto) so class-validator actually walks the children.
 */
export class SaleItemDto {
  @ApiProperty({
    description:
      'Product sold on this line. Must belong to the shop in the JWT.',
    example: '01924f0a-0000-7000-8000-000000000101',
  })
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({
    description:
      'SERIALIZED (phone) lines only: the exact unit being sold, by id. ' +
      'The unit must be IN_STOCK in this shop and belong to productId. ' +
      'When present, quantity is forced to 1.',
    example: '01924f0a-0000-7000-8000-000000000301',
  })
  @IsOptional()
  @IsUUID()
  inventoryUnitId?: string;

  @ApiProperty({
    description:
      'How many are sold. More than 0. Must be 1 on a phone line (one IMEI = one unit).',
    example: 2,
    default: 1,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quantity: number;

  @ApiProperty({
    description:
      'Selling price of ONE unit in PAISA (Rs 800 = 80000). Server multiplies it out; subtotal and totalAmount are never accepted from the client.',
    example: 80000,
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  unitPrice: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const IMEI_PATTERN = /^[0-9A-Za-z]{4,20}$/;

/**
 * One line of a purchase. Nested inside CreatePurchaseDto with
 * @Type(() => PurchaseItemDto) so class-validator actually walks the children.
 */
export class PurchaseItemDto {
  @ApiProperty({
    description:
      'Product bought on this line. Must belong to the shop in the JWT.',
    example: '01924f0a-0000-7000-8000-000000000101',
  })
  @IsUUID()
  productId: string;

  @ApiProperty({
    description:
      'How many were bought. More than 0. For SERIALIZED products this must equal the number of IMEIs.',
    example: 40,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  quantity: number;

  @ApiProperty({
    description:
      'Cost of ONE unit in PAISA (Rs 500 = 50000). Server multiplies it out; totalAmount is never accepted from the client.',
    example: 50000,
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  unitCost: number;

  @ApiPropertyOptional({
    description:
      'SERIALIZED products only. One IMEI per phone. Length must equal quantity.',
    example: ['111223344556677', '111223344556688'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(IMEI_PATTERN, { each: true })
  imeis?: string[];

  @ApiPropertyOptional({
    description:
      'SERIALIZED products only. Physical condition of the phones on this line.',
    example: 'NEW',
    default: 'NEW',
  })
  @IsOptional()
  @IsIn(['NEW', 'USED'])
  condition?: 'NEW' | 'USED';
}

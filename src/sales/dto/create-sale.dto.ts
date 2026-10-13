import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { SaleItemDto } from './sale-item.dto.js';

export class CreateSaleDto {
  @ApiProperty({
    description:
      'Double-tap protection. Generate ONE uuid per opened Save screen and reuse it if the request is retried. If this id was already saved the system returns success instead of creating a second sale.',
    example: '01924f0a-0000-7000-8000-00000000beef',
  })
  @IsUUID()
  clientRequestId: string;

  @ApiPropertyOptional({
    description:
      'Who is buying. Required when the sale contains a phone, or when any amount stays unpaid (Udhar). Omit for a walk-in full-cash accessory sale.',
    example: '01924f0a-0000-7000-8000-0000000000a7',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({
    description: 'Day of the sale, as YYYY-MM-DD.',
    example: '2026-10-07',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  saleDate: string;

  @ApiProperty({
    description:
      'Line list. At least one. Each line is product + quantity + unit price (+ inventoryUnitId for phones).',
    type: [SaleItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items: SaleItemDto[];

  @ApiPropertyOptional({
    description:
      'One sale-level discount in PAISA. Cannot exceed the subtotal. No item-level discount exists.',
    example: 10000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  discount?: number;

  @ApiPropertyOptional({
    description:
      'How much cash the customer hands over now, in PAISA. 0 = full Udhar, anything = part payment. Cannot exceed the sale total.',
    example: 200000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  paidNow?: number;

  @ApiPropertyOptional({
    description:
      'When the unpaid balance is due, as YYYY-MM-DD. Only meaningful when something stays unpaid.',
    example: '2026-10-15',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    example: 'Bought the charger with the cover',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

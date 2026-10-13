import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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
import { PurchaseItemDto } from './purchase-item.dto.js';

export class CreatePurchaseDto {
  @ApiProperty({
    description:
      'Double-tap protection. Generate ONE uuid per opened Save screen and reuse it if the request is retried. If this id was already saved the system returns the first purchase instead of creating a second one.',
    example: '01924f0a-0000-7000-8000-00000000beef',
  })
  @IsUUID()
  clientRequestId: string;

  @ApiProperty({
    description: 'Who the goods were bought from. Must belong to this shop.',
    example: '01924f0a-0000-7000-8000-00000000000a',
  })
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({
    description: "The supplier's own invoice / paper number, if they gave one.",
    example: 'AB-771',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 100)
  supplierInvoiceRef?: string;

  @ApiProperty({
    description: 'Day the goods were bought, as YYYY-MM-DD.',
    example: '2026-10-06',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  purchaseDate: string;

  @ApiProperty({
    description:
      'Line list. At least one. Each line is product + quantity + unit cost (+ IMEIs for phones).',
    type: [PurchaseItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];

  @ApiPropertyOptional({
    description:
      'How much cash leaves the drawer now, in PAISA. 0 = full Udhar, anything = part payment. Cannot exceed the purchase total. Ignored entirely when isOpeningStock is true.',
    example: 10000000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  paidNow?: number;

  @ApiPropertyOptional({
    description:
      'Day-0 stock entry (old stock you already had). No supplier payable and no cash movement is written for it.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isOpeningStock?: boolean;

  @ApiPropertyOptional({
    description:
      'Set true only after the server answered with confirmOverdraft — meaning this payment would take cash below zero and the owner accepted the warning.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;

  @ApiPropertyOptional({
    example: 'Bought from the Sunday market',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

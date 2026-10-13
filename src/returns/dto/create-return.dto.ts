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
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReturnItemDto } from './return-item.dto.js';

export class CreateReturnDto {
  @ApiProperty({
    description:
      'Why the items are coming back. Required — a stock or cash change with no reason is a lie in the ledger. 1–1000 chars after trim.',
    example: 'Customer bought the wrong charger',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000)
  reason: string;

  @ApiProperty({
    description:
      'Business day of the return, as YYYY-MM-DD. The refund (if any) is recorded on the same day.',
    example: '2026-10-07',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  returnDate: string;

  @ApiProperty({
    description:
      'Lines being returned. At least one. Each line names its sale line and the condition it comes back in.',
    type: [ReturnItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @ApiPropertyOptional({
    description:
      "Cash given back now, in PAISA. 0 (or omit) keeps the whole return value against the sale's Udhar. Cannot exceed what is refundable: the return value first cancels the outstanding Udhar, and only the already-paid remainder can leave the drawer.",
    example: 70000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  refundAmount?: number;

  @ApiPropertyOptional({
    description:
      'Send true to retry after the "cash below zero" warning. Only needed when refundAmount would take the drawer negative.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;

  @ApiPropertyOptional({ example: 'Original box included', maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

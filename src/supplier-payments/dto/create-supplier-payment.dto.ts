import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
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
} from 'class-validator';

export class CreateSupplierPaymentDto {
  @ApiProperty({
    description: 'Who is being paid. Must belong to this shop.',
    example: '01924f0a-0000-7000-8000-00000000000a',
  })
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({
    description:
      'Pay one specific bill. Omit (or send null) to pay down the opening balance instead — that is the "pay what was already owed before this app" case.',
    example: '01924f0a-0000-7000-8000-0000000000c1',
  })
  @IsOptional()
  @IsUUID()
  purchaseId?: string | null;

  @ApiProperty({
    description:
      'How much cash leaves the drawer, in PAISA. Must be more than 0.',
    example: 9000000,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiProperty({
    description: 'Day the money was handed over, as YYYY-MM-DD.',
    example: '2026-10-06',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  paymentDate: string;

  @ApiPropertyOptional({
    description:
      'Set true only after the server answered with confirmOverdraft — meaning this payment would take cash below zero and the owner accepted the warning.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;

  @ApiPropertyOptional({ example: 'Paid in cash at the shop', maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

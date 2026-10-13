import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateOwnerWithdrawalDto {
  @ApiProperty({
    description:
      'Cash the owner takes out of the shop, in PAISA. Rs 50,000 = 5000000. Must be greater than zero.',
    example: 5000000,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiPropertyOptional({
    description:
      'Business day the money left the drawer, as YYYY-MM-DD. Defaults to today in Asia/Karachi.',
    example: '2026-10-08',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Optional note about the withdrawal.',
    example: 'Took money home',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Send true to accept that this withdrawal takes the drawer below zero. ' +
      'Without it the request answers 200 with the shortfall and writes nothing.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;
}

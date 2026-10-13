import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateOwnerInvestmentDto {
  @ApiProperty({
    description:
      'Cash the owner puts into the shop, in PAISA. Rs 200,000 = 20000000. Must be greater than zero.',
    example: 20000000,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiPropertyOptional({
    description:
      'Business day the money entered the drawer, as YYYY-MM-DD. Defaults to today in Asia/Karachi.',
    example: '2026-10-08',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Optional note about the investment.',
    example: 'Brought money from home to restock',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

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

export class CreateOpeningCashDto {
  @ApiProperty({
    description:
      'Cash in the drawer on day one, in PAISA. Rs 500,000 = 50000000. Must be greater than zero.',
    example: 50000000,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiPropertyOptional({
    description:
      'Business day this opening cash starts, as YYYY-MM-DD. Defaults to today in Asia/Karachi.',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  date?: string;

  @ApiPropertyOptional({
    description: 'Optional note about where the starting cash came from.',
    example: 'Cash register opening balance',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

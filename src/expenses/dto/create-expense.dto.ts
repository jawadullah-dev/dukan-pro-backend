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

export class CreateExpenseDto {
  @ApiProperty({
    description:
      'Expense category this cost belongs to. Must belong to this shop.',
    example: '01924f0a-0000-7000-8000-000000000101',
  })
  @IsUUID()
  categoryId: string;

  @ApiProperty({
    description:
      'Amount paid, in PAISA. Rs 5,000 = 500000. Must be greater than zero.',
    example: 500000,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiProperty({
    description: 'Day the expense was paid, as YYYY-MM-DD.',
    example: '2026-10-06',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  expenseDate: string;

  @ApiPropertyOptional({
    description: 'Optional note about what the expense was for.',
    example: 'October electricity bill',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Set true only after the server answered with confirmOverdraft — meaning this expense would take cash below zero and the owner accepted the warning.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;
}

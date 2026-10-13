import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type {
  CashDirection,
  CashMovementType,
} from '../../generated/prisma/enums.js';

export class CashMovementQueryFilterDto {
  @ApiPropertyOptional({ example: 1, description: '1-based page number.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, description: 'Rows per page, max 100.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({
    example: 'EXPENSE',
    description:
      'OPENING_CASH | CUSTOMER_PAYMENT | SUPPLIER_PAYMENT | EXPENSE | REVERSAL | REFUND | OWNER_INVESTMENT | OWNER_WITHDRAWAL | RECONCILIATION_ADJUSTMENT. Omit for all.',
  })
  @IsOptional()
  @IsIn([
    'OPENING_CASH',
    'CUSTOMER_PAYMENT',
    'SUPPLIER_PAYMENT',
    'EXPENSE',
    'REVERSAL',
    'REFUND',
    'OWNER_INVESTMENT',
    'OWNER_WITHDRAWAL',
    'RECONCILIATION_ADJUSTMENT',
  ])
  type?: CashMovementType;

  @ApiPropertyOptional({
    example: 'OUT',
    description: 'IN or OUT. Omit for both.',
  })
  @IsOptional()
  @IsIn(['IN', 'OUT'])
  direction?: CashDirection;

  @ApiPropertyOptional({
    example: 'rent',
    description: 'Case-insensitive contains search on the note.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description:
      'Inclusive lower bound on movementDate (business day, PKT), YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description:
      'Inclusive upper bound on movementDate (business day, PKT), YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    example: 'movementDate',
    description: 'movementDate | amount | createdAt.',
  })
  @IsOptional()
  @IsIn(['movementDate', 'amount', 'createdAt'])
  sortBy?: 'movementDate' | 'amount' | 'createdAt' = 'movementDate';

  @ApiPropertyOptional({ example: 'desc', description: 'asc or desc.' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

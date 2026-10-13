import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SupplierPaymentQueryFilterDto {
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
    example: 'ABC Mobiles',
    description:
      'Case-insensitive contains search across the supplier name and the purchase number the payment was made against.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-00000000000a',
    description: 'Only payments made to this supplier.',
  })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-0000000000c1',
    description: 'Only payments made against this purchase.',
  })
  @IsOptional()
  @IsUUID()
  purchaseId?: string;

  @ApiPropertyOptional({
    example: 'ACTIVE',
    description: 'ACTIVE (default) or CANCELLED. Omit for both.',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'CANCELLED'])
  status?: 'ACTIVE' | 'CANCELLED';

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Inclusive lower bound on paymentDate, YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Inclusive upper bound on paymentDate, YYYY-MM-DD.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    example: 'paymentDate',
    description: 'paymentDate | amount | createdAt | updatedAt.',
  })
  @IsOptional()
  @IsIn(['paymentDate', 'amount', 'createdAt', 'updatedAt'])
  sortBy?: 'paymentDate' | 'amount' | 'createdAt' | 'updatedAt' = 'paymentDate';

  @ApiPropertyOptional({ example: 'desc', description: 'asc or desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

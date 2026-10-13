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

export class PaymentQueryFilterDto {
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
    example: 'ali',
    description:
      'Case-insensitive contains search across the customer name and the payment notes.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-0000000000a7',
    description: 'Only payments of this customer.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-0000000001c1',
    description: 'Only payments applied to this sale.',
  })
  @IsOptional()
  @IsUUID()
  saleId?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-0000000009e2',
    description:
      'Only rows of this receipt group — one request that split a payment across several sales shares one receiptGroupId.',
  })
  @IsOptional()
  @IsUUID()
  receiptGroupId?: string;

  @ApiPropertyOptional({
    example: 'ACTIVE',
    description:
      'ACTIVE or CANCELLED. Omit for both — cancelled rows stay visible.',
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

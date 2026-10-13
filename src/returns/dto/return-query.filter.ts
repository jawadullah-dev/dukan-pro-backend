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

export class ReturnQueryFilterDto {
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
    example: 'wrong charger',
    description:
      'Case-insensitive contains search across the sale number, the customer name and the reason.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-0000000000aa',
    description: 'Only returns against this sale.',
  })
  @IsOptional()
  @IsUUID()
  saleId?: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-0000000000a7',
    description: 'Only returns of this customer.',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Inclusive lower bound on returnDate (PKT business day).',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Inclusive upper bound on returnDate (PKT business day).',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    example: 'returnDate',
    description: 'returnDate | returnAmount | createdAt | updatedAt.',
  })
  @IsOptional()
  @IsIn(['returnDate', 'returnAmount', 'createdAt', 'updatedAt'])
  sortBy?: 'returnDate' | 'returnAmount' | 'createdAt' | 'updatedAt' =
    'returnDate';

  @ApiPropertyOptional({ example: 'desc', description: 'asc or desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { ReportPeriod } from '../../helpers/date.helper.js';

/**
 * Query contract shared by every WF18 report.
 *
 * Period resolution (see `periodRange` in date.helper):
 * - `period=today|week|month` — Today / this Monday-start week / this month.
 * - Passing `from`/`to` at all switches to a custom range (a missing side
 *   defaults to the other side = a single-day range).
 *
 * The three snapshot reports (customers, suppliers, inventory) ignore the
 * date fields entirely — outstanding, payable and stock are cumulative facts.
 * `sortBy` is a free string, whitelisted per report in the service.
 */
export class ReportQueryFilterDto {
  @ApiPropertyOptional({
    enum: ['today', 'week', 'month', 'custom'],
    description:
      'today | week (Monday start) | month | custom. Ignored when from/to are passed.',
  })
  @IsOptional()
  @IsIn(['today', 'week', 'month', 'custom'])
  period?: ReportPeriod;

  @ApiPropertyOptional({
    description:
      'Custom range start, Asia/Karachi business date. Implies a custom range.',
    example: '2026-10-01',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({
    description: 'Custom range end (inclusive), Asia/Karachi business date.',
    example: '2026-10-31',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({
    description: 'Free-text search. Column depends on the report.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Sort column — whitelisted per report (e.g. saleDate, totalAmount, name). Defaults listed per report.',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    enum: ['csv'],
    description:
      'format=csv returns a text/csv download instead of JSON. PDF is a later ticket — the same plumbing.',
  })
  @IsOptional()
  @IsIn(['csv', 'pdf'])
  format?: 'csv' | 'pdf';
}

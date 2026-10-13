import { ApiProperty } from '@nestjs/swagger';

/**
 * WF18 page shape. The normal list contract is `PaginatedResponseDTO`
 * `{ page, pageSize, total, items }`; a report adds the applied business-day
 * range and a report-specific `summary` (whole-period or whole-shop totals,
 * not just the page's rows). `items` are never a bare array.
 */
export class ReportPageResponseDTO<T, S = Record<string, never>> {
  @ApiProperty({ description: 'Current page number (1-based)' })
  page: number;

  @ApiProperty({ description: 'Number of items requested per page' })
  pageSize: number;

  @ApiProperty({ description: 'Total matching rows across all pages' })
  total: number;

  @ApiProperty({
    description: 'Applied start as a plain business date, inclusive.',
  })
  from: string;

  @ApiProperty({
    description: 'Applied end as a plain business date, inclusive.',
  })
  to: string;

  @ApiProperty({
    description: 'Report totals — the whole range/shop, not just this page.',
  })
  summary: S;

  @ApiProperty({ isArray: true, description: 'Rows for the requested page.' })
  items: T[];

  constructor(
    items: T[],
    summary: S,
    total: number,
    page: number,
    pageSize: number,
    from: string,
    to: string,
  ) {
    this.items = items;
    this.summary = summary;
    this.total = total;
    this.page = page;
    this.pageSize = pageSize;
    this.from = from;
    this.to = to;
  }
}

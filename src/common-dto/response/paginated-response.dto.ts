import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, Min } from 'class-validator';

/**
 * Frontend service contract: every list endpoint returns
 * { items, total, page, pageSize } so dukan-pro/src/features/<name>/api/service.ts
 * can stay mechanical. Constructor-created, same shape every time.
 */
export class PaginatedResponseDTO<T> {
  @ApiProperty({ description: 'Current page number (1-based)' })
  @IsNumber()
  @Min(1)
  page: number;

  @ApiProperty({ description: 'Number of items requested per page' })
  @IsNumber()
  @Min(1)
  pageSize: number;

  @ApiProperty({ description: 'Total matching rows across all pages' })
  @IsNumber()
  @Min(0)
  total: number;

  @ApiProperty({ isArray: true, description: 'Rows for the requested page' })
  @IsArray()
  items: T[];

  constructor(items: T[], total: number, page: number, pageSize: number) {
    this.items = items;
    this.total = total;
    this.page = page;
    this.pageSize = pageSize;
  }
}

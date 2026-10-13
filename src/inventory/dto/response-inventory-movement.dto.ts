import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One row of the stock-movement history — an append-only ledger, never edited. */
export class ResponseInventoryMovementDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-0000000000e1' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000000' })
  shopId: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000101' })
  productId: string;

  @ApiProperty({ example: 'Samsung Charger' })
  productName: string;

  @ApiPropertyOptional({
    example: '01924f0a-0000-7000-8000-0000000000d1',
    description: 'The affected phone unit, when the change targets one phone.',
  })
  inventoryUnitId?: string | null;

  @ApiPropertyOptional({
    example: '111223344556677',
    description: "The phone's first IMEI when inventoryUnitId is set.",
  })
  imei?: string | null;

  @ApiProperty({ example: 'ADJUSTMENT' })
  type: string;

  @ApiProperty({
    example: -2,
    description: 'Signed change: +in / −out. Never 0 (DB CHECK).',
  })
  quantityChange: number;

  @ApiProperty({ example: 'Counting difference at the end of the day' })
  reason: string | null;

  @ApiPropertyOptional({ example: null, description: 'Kept null for WF8.' })
  referenceType?: string | null;

  @ApiPropertyOptional({ example: null })
  referenceId?: string | null;

  @ApiProperty({
    example: '2026-10-07T12:00:00.000Z',
    description: 'When the change was written.',
  })
  createdAt: Date;
}

/** The list endpoint returns this shape per row. */
export class PaginatedInventoryMovementDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  pageSize: number;

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ type: [ResponseInventoryMovementDto] })
  items: ResponseInventoryMovementDto[];
}

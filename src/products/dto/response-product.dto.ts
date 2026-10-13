import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Output DTO returned by GET endpoints. Shape mirrors the Prisma row plus the
 * joined category/brand names and the live on-hand quantity, so the list screen
 * needs exactly one request.
 */
export class ResponseProductDto {
  @ApiProperty({
    description: 'UUID v7 of this product row.',
    example: '01924f0a-0000-7000-8000-000000000002',
  })
  id: string;

  @ApiProperty({
    description:
      'Shop that owns this product. Every product is scoped per-tenant.',
    example: '01924f0a-0000-7000-8000-000000000000',
  })
  shopId: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000000' })
  categoryId: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000001' })
  brandId: string;

  @ApiProperty({
    description: 'Denormalised category name, for display only.',
    example: 'Accessories',
  })
  categoryName: string;

  @ApiProperty({
    description: 'Denormalised brand name, for display only.',
    example: 'Samsung',
  })
  brandName: string;

  @ApiProperty({ example: 'Galaxy A15' })
  name: string;

  @ApiProperty({
    description:
      'QUANTITY = counter based. SERIALIZED = one row per IMEI. Locked after the first purchase or sale.',
    enum: ['QUANTITY', 'SERIALIZED'],
    example: 'SERIALIZED',
  })
  trackingType: 'QUANTITY' | 'SERIALIZED';

  @ApiPropertyOptional({ example: 'SM-A155F' })
  model?: string | null;

  @ApiPropertyOptional({ example: 'Blue' })
  color?: string | null;

  @ApiPropertyOptional({ example: '8GB' })
  ram?: string | null;

  @ApiPropertyOptional({ example: '128GB' })
  storage?: string | null;

  @ApiPropertyOptional({ example: 'A15-BLU-128' })
  sku?: string | null;

  @ApiPropertyOptional({ example: '356938035643809' })
  barcode?: string | null;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiPropertyOptional()
  imageUrl?: string | null;

  @ApiProperty({
    description: 'Suggested cost in PAISA (Rs 1 = 100 paisa).',
    example: 4500000,
  })
  defaultPurchasePrice: number;

  @ApiProperty({
    description: 'Suggested selling price in PAISA (Rs 1 = 100 paisa).',
    example: 699900,
  })
  defaultSellingPrice: number;

  @ApiProperty({ example: 3 })
  lowStockThreshold: number;

  @ApiProperty({
    example: true,
    description:
      'Deactivated products are hidden from pickers but kept for history.',
  })
  isActive: boolean;

  @ApiProperty({
    description:
      'Whether this product is visible in the public online store (WF20). New products start false.',
    example: false,
  })
  isPublished: boolean;

  @ApiPropertyOptional({
    description:
      'Public description shown to customers. Never the private `description`.',
    example: 'Brand new, box pack, 1 year warranty.',
  })
  publicDescription?: string | null;

  @ApiProperty({
    description:
      'When true the public store hides the price and shows "Contact for price".',
    example: false,
  })
  contactForPrice: boolean;

  @ApiPropertyOptional({
    description:
      'PTA approval status for phones (PTA_APPROVED / NON_PTA). Null for accessories.',
    enum: ['PTA_APPROVED', 'NON_PTA'],
    example: 'PTA_APPROVED',
  })
  ptaStatus?: 'PTA_APPROVED' | 'NON_PTA' | null;

  @ApiProperty({
    description:
      'Live on-hand quantity. For QUANTITY products this is stock_levels.quantity_on_hand; for SERIALIZED products it is the number of units currently IN_STOCK. Read-only.',
    example: 4,
  })
  quantityOnHand: number;

  @ApiProperty({
    description: 'Row creation timestamp, UTC.',
    example: '2026-10-05T09:20:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Last edit timestamp, UTC.',
    example: '2026-10-05T09:20:00.000Z',
  })
  updatedAt: Date;
}

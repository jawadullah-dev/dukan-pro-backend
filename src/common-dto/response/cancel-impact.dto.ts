import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One stock line a cancel will change (WF12 step 3 — the impact preview).
 * Positive quantityChange puts stock back, negative takes it off the shelf.
 */
export class CancelImpactStockItemDto {
  @ApiProperty({
    description: 'Product the stock line belongs to.',
    example: 'Samsung A15 128GB',
  })
  productName: string;

  @ApiPropertyOptional({
    description: 'IMEI for a phone line; null for accessory lines.',
    example: '111111111111111',
  })
  imei?: string | null;

  @ApiProperty({
    description:
      'How quantity changes when the cancel is confirmed: + restores stock, − removes it.',
    example: 1,
  })
  quantityChange: number;
}

/**
 * What a cancel will do BEFORE it is saved (WF12 step 3). Read-only: the
 * endpoint behind this DTO writes nothing — the owner sees stock, cash and
 * Udhar/payable impact, then confirms through POST .../cancel.
 */
export class CancelImpactResponseDto {
  @ApiProperty({
    description: 'Which kind of record is being previewed.',
    enum: ['SALE', 'PURCHASE', 'PAYMENT', 'SUPPLIER_PAYMENT'],
    example: 'SALE',
  })
  recordType: 'SALE' | 'PURCHASE' | 'PAYMENT' | 'SUPPLIER_PAYMENT';

  @ApiProperty({
    description: 'Id of the record being previewed.',
    example: '01924f0a-0000-7000-8000-000000000101',
  })
  recordId: string;

  @ApiPropertyOptional({
    description:
      'S-0002 / P-0001. null for payment records (they have no doc number).',
    example: 'S-0002',
  })
  recordNo: string | null;

  @ApiProperty({
    description: 'Drawer cash right now, in PAISA.',
    example: 5000000,
  })
  currentCash: number;

  @ApiProperty({
    description:
      'Total cash the cancel will reverse, in PAISA (always positive).',
    example: 5000000,
  })
  cashReversedAmount: number;

  @ApiProperty({
    description:
      'Direction of the reversal rows: OUT when money leaves (sale / customer payment cancel), IN when it comes back (purchase / supplier payment cancel).',
    enum: ['IN', 'OUT'],
    example: 'OUT',
  })
  cashReversedDirection: 'IN' | 'OUT';

  @ApiProperty({
    description: 'Drawer cash after the cancel, in PAISA.',
    example: 0,
  })
  cashAfter: number;

  @ApiProperty({
    description:
      'True when cashAfter is below zero. Cancels that take money OUT (sale / customer payment) will show the soft confirmOverdraft prompt in that state; cancels that bring money IN never prompt — they only shrink an existing deficit.',
    example: false,
  })
  willCauseOverdraft: boolean;

  @ApiPropertyOptional({
    description:
      'Customer Udhar after the cancel, in PAISA. null when the record has no customer side.',
    example: 0,
    nullable: true,
  })
  customerUdharAfter: number | null;

  @ApiPropertyOptional({
    description:
      'Supplier payable after the cancel, in PAISA. null when the record has no supplier side.',
    example: 0,
    nullable: true,
  })
  supplierPayableAfter: number | null;

  @ApiProperty({
    description:
      'Stock lines the cancel will change. Empty for payment cancels.',
    type: [CancelImpactStockItemDto],
  })
  stockItems: CancelImpactStockItemDto[];

  @ApiProperty({
    description:
      'True when confirming would be refused (e.g. a phone from this purchase is no longer IN_STOCK).',
    example: false,
  })
  blocked: boolean;

  @ApiPropertyOptional({
    description:
      'Why the cancel would be refused, in the same words the 400 would use. null when not blocked.',
    nullable: true,
    example: null,
  })
  blockedReason: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResponseCashMovementDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000c01' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000000' })
  shopId: string;

  @ApiProperty({
    description:
      'OPENING_CASH | CUSTOMER_PAYMENT | SUPPLIER_PAYMENT | EXPENSE | REVERSAL | REFUND | OWNER_INVESTMENT | OWNER_WITHDRAWAL | RECONCILIATION_ADJUSTMENT.',
    example: 'EXPENSE',
  })
  type: string;

  @ApiProperty({
    description:
      'IN adds to the drawer, OUT removes. The amount is always positive.',
    example: 'OUT',
  })
  direction: string;

  @ApiProperty({ description: 'Always positive, in PAISA.', example: 500000 })
  amount: number;

  @ApiProperty({ example: '2026-10-06T00:00:00.000Z' })
  movementDate: string;

  @ApiPropertyOptional({ example: null })
  referenceType: string | null;

  @ApiPropertyOptional({ example: null })
  referenceId: string | null;

  @ApiPropertyOptional({
    description: 'Set on REVERSAL rows: the movement this row undoes.',
    example: null,
  })
  reversesMovementId: string | null;

  @ApiProperty({
    description: 'Saved after the owner accepted a cash-below-zero warning.',
    example: false,
  })
  isOverdraft: boolean;

  @ApiPropertyOptional({ example: 'October electricity bill' })
  note: string | null;

  @ApiProperty({ example: 'user-uuid' })
  createdById: string;

  @ApiProperty({ example: '2026-10-06T09:20:00.000Z' })
  createdAt: Date;
}

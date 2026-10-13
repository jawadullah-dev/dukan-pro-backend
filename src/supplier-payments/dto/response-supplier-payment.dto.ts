import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One payment as stored, with the names resolved in the list query. */
export class ResponseSupplierPaymentDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000301' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000000' })
  shopId: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-00000000000a' })
  supplierId: string;

  @ApiPropertyOptional({
    description: 'Resolved in one join so lists need no second call.',
    example: 'ABC Mobiles, Peshawar',
  })
  supplierName?: string;

  @ApiPropertyOptional({
    description: 'null means this payment was against the opening balance.',
    example: null,
  })
  purchaseId?: string | null;

  @ApiPropertyOptional({
    description: 'The bill this payment was made against, when there is one.',
    example: 'P-0003',
  })
  purchaseNo?: string | null;

  @ApiProperty({
    description: 'PAISA that left the drawer.',
    example: 9000000,
  })
  amount: number;

  @ApiProperty({ description: 'YYYY-MM-DD.', example: '2026-10-06' })
  paymentDate: string;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiPropertyOptional({ example: null })
  cancelledAt?: Date | null;

  @ApiPropertyOptional({ example: null })
  cancelReason?: string | null;

  @ApiPropertyOptional({ example: null })
  cancelledById?: string | null;

  @ApiPropertyOptional({ example: 'Paid in cash at the shop' })
  notes?: string | null;

  @ApiProperty({ description: 'Owner who saved it.', example: 'user-uuid' })
  createdById: string;

  @ApiProperty({ example: '2026-10-06T09:20:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-06T09:20:00.000Z' })
  updatedAt: Date;
}

/** One unpaid bill, oldest first — exactly what step 2 of WF7 renders. */
export class UnpaidPurchaseDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-0000000000c1' })
  id: string;

  @ApiProperty({ example: 'P-0003' })
  purchaseNo: string;

  @ApiPropertyOptional({ example: 'AB-771' })
  supplierInvoiceRef?: string | null;

  @ApiProperty({ description: 'YYYY-MM-DD.', example: '2026-10-06' })
  purchaseDate: string;

  @ApiProperty({ description: 'The bill total, in PAISA.', example: 19000000 })
  totalAmount: number;

  @ApiProperty({
    description: 'Active payments already made against it, in PAISA.',
    example: 10000000,
  })
  paidAmount: number;

  @ApiProperty({
    description: 'totalAmount − paidAmount. This is what can still be paid.',
    example: 9000000,
  })
  remaining: number;
}

/** What the owner sees when they open a supplier and press "pay later". */
export class SupplierPayableDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-00000000000a' })
  supplierId: string;

  @ApiProperty({ example: 'ABC Mobiles, Peshawar' })
  supplierName: string;

  @ApiProperty({
    description:
      'Day-0 debt typed in when the supplier was created. Never edited by payments.',
    example: 5000000,
  })
  openingBalance: number;

  @ApiProperty({
    description: 'openingBalance minus the active opening-balance payments.',
    example: 0,
  })
  openingRemaining: number;

  @ApiProperty({
    description: 'Σ active real purchases (opening-stock entries excluded).',
    example: 46000000,
  })
  totalPurchases: number;

  @ApiProperty({
    description: 'Σ active supplier_payments for this supplier.',
    example: 10000000,
  })
  totalPaid: number;

  @ApiProperty({
    description:
      'What is still owed: openingBalance + totalPurchases − totalPaid. Derived from active rows only, never stored.',
    example: 41000000,
  })
  payable: number;

  @ApiProperty({ type: [UnpaidPurchaseDto] })
  unpaidPurchases: UnpaidPurchaseDto[];
}

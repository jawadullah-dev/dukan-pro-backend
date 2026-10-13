import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One customer payment row, as stored. */
export class ResponsePaymentDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000401' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000000' })
  shopId: string;

  @ApiPropertyOptional({
    description: 'null only for rows written before a customer was attached.',
    example: '01924f0a-0000-7000-8000-0000000000a7',
  })
  customerId?: string | null;

  @ApiPropertyOptional({
    description:
      'Customer name, resolved in one join so lists need no second call.',
    example: 'Ali Khan',
  })
  customerName?: string;

  @ApiPropertyOptional({
    description:
      'null = the payment was against the opening balance (old Udhar).',
    example: '01924f0a-0000-7000-8000-0000000001c1',
  })
  saleId?: string | null;

  @ApiPropertyOptional({
    description: 'Sale number this row pays (null for the opening balance).',
    example: 'S-0002',
  })
  saleNo?: string | null;

  @ApiPropertyOptional({
    description:
      'Rows written by ONE request share this id — one receipt covering several sales.',
    example: '01924f0a-0000-7000-8000-0000000009e2',
  })
  receiptGroupId?: string | null;

  @ApiProperty({ description: 'In PAISA.', example: 500000 })
  amount: number;

  @ApiProperty({ example: '2026-10-07T00:00:00.000Z' })
  paymentDate: Date;

  @ApiProperty({ example: 'CASH' })
  method: string;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiPropertyOptional({ example: null })
  cancelledAt?: Date | null;

  @ApiPropertyOptional({ example: null })
  cancelReason?: string | null;

  @ApiPropertyOptional({ example: null })
  cancelledById?: string | null;

  @ApiProperty({
    description: 'Idempotency key this payment was saved under.',
    example: '01924f0a-0000-7000-8000-00000000beef',
  })
  clientRequestId: string;

  @ApiPropertyOptional({ example: 'Part of the laptop money' })
  notes?: string | null;

  @ApiProperty({ description: 'Owner who saved it.', example: 'user-uuid' })
  createdById: string;

  @ApiProperty({ example: '2026-10-07T09:20:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-07T09:20:00.000Z' })
  updatedAt: Date;
}

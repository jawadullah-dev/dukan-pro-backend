import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One line of a saved return, joined with its sale line for names. */
export class ResponseReturnItemDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000501' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000201' })
  saleItemId: string;

  @ApiPropertyOptional({
    description: 'Phone lines only — the exact unit that came back.',
    example: '01924f0a-0000-7000-8000-000000000301',
  })
  inventoryUnitId?: string | null;

  @ApiPropertyOptional({ example: '111223344556677' })
  imei?: string | null;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000101' })
  productId: string;

  @ApiProperty({ example: 'Samsung Charger 25W' })
  productName: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ enum: ['GOOD', 'DAMAGED'], example: 'GOOD' })
  condition: string;
}

/** Cash given back against a return. Immutable — no cancel endpoint exists. */
export class ResponseRefundDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000601' })
  id: string;

  @ApiProperty({ description: 'In PAISA.', example: 7000000 })
  amount: number;

  @ApiProperty({ example: '2026-10-07T00:00:00.000Z' })
  refundDate: Date;

  @ApiProperty({ example: 'CASH' })
  method: string;

  @ApiPropertyOptional({ example: 'Returned with the original box' })
  notes?: string | null;
}

export class ResponseReturnDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000701' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-0000000000aa' })
  saleId: string;

  @ApiProperty({
    description: 'Automatic sale number of the original sale.',
    example: 'S-0001',
  })
  saleNo: string;

  @ApiPropertyOptional({ example: '01924f0a-0000-7000-8000-0000000000a7' })
  customerId?: string | null;

  @ApiPropertyOptional({ example: 'Ali Khan' })
  customerName?: string | null;

  @ApiProperty({ example: '2026-10-07T00:00:00.000Z' })
  returnDate: Date;

  @ApiProperty({ example: 'Customer bought the wrong charger' })
  reason: string;

  @ApiProperty({
    description: 'Server-computed value of this return, in PAISA.',
    example: 10000000,
  })
  returnAmount: number;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiPropertyOptional({ example: 'Original box included' })
  notes?: string | null;

  @ApiProperty({ example: 'user-uuid' })
  createdById: string;

  @ApiProperty({ example: '2026-10-07T10:15:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-07T10:15:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ type: [ResponseReturnItemDto] })
  items: ResponseReturnItemDto[];

  @ApiProperty({
    description:
      'Cash given back for this return (empty when nothing was refunded).',
    type: [ResponseRefundDto],
  })
  refunds: ResponseRefundDto[];
}

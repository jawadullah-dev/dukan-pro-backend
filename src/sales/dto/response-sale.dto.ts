import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ResponseReturnDto } from '../../returns/dto/response-return.dto.js';

/** One line of a sale, as stored. */
export class ResponseSaleItemDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000201' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000101' })
  productId: string;

  @ApiProperty({ example: 'Samsung Charger 25W' })
  productName: string;

  @ApiPropertyOptional({
    description:
      'The exact phone sold (SERIALIZED products only), by inventory unit id.',
    example: '01924f0a-0000-7000-8000-000000000301',
  })
  inventoryUnitId?: string | null;

  @ApiPropertyOptional({
    description: 'IMEI of that phone, resolved in one join.',
    example: '111223344556677',
  })
  imei?: string | null;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({
    description: 'Selling price of ONE unit at sale time, in PAISA.',
    example: 80000,
  })
  unitPrice: number;

  @ApiProperty({
    description:
      'Cost of ONE unit at sale time, in PAISA. Snapshotted so profit never changes later.',
    example: 50000,
  })
  unitCost: number;

  @ApiProperty({
    description: 'quantity × unitPrice, in PAISA.',
    example: 160000,
  })
  total: number;
}

/** One customer payment against a sale. */
export class ResponsePaymentDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000401' })
  id: string;

  @ApiProperty({ description: 'In PAISA.', example: 500000 })
  amount: number;

  @ApiProperty({ example: '2026-10-07T09:30:00.000Z' })
  paymentDate: Date;

  @ApiProperty({ example: 'CASH' })
  method: string;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;
}

export class ResponseSaleDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-0000000000aa' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000000' })
  shopId: string;

  @ApiPropertyOptional({
    description: 'null = walk-in (full-cash accessory sale).',
    example: '01924f0a-0000-7000-8000-0000000000a7',
  })
  customerId?: string | null;

  @ApiPropertyOptional({
    description:
      'Customer name, resolved in one join so lists need no second call.',
    example: 'Ali Khan',
  })
  customerName?: string;

  @ApiProperty({
    description: 'Our automatic number: S-0001, S-0002 …',
    example: 'S-0001',
  })
  saleNo: string;

  @ApiProperty({ example: '2026-10-07T00:00:00.000Z' })
  saleDate: Date;

  @ApiProperty({
    description: 'Σ line totals, computed by the server. In PAISA.',
    example: 210000,
  })
  subtotal: number;

  @ApiProperty({
    description: 'Sale-level discount in PAISA. No item-level discount exists.',
    example: 10000,
  })
  discount: number;

  @ApiProperty({
    description: 'subtotal − discount, in PAISA.',
    example: 200000,
  })
  totalAmount: number;

  @ApiPropertyOptional({
    description: 'YYYY-MM-DD, when the unpaid balance is due.',
    example: '2026-10-15',
  })
  dueDate?: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiPropertyOptional({ example: null })
  cancelledAt?: Date | null;

  @ApiPropertyOptional({ example: null })
  cancelReason?: string | null;

  @ApiPropertyOptional({ example: null })
  cancelledById?: string | null;

  @ApiProperty({
    description: 'Idempotency key this sale was saved under.',
    example: '01924f0a-0000-7000-8000-00000000beef',
  })
  clientRequestId: string;

  @ApiPropertyOptional({ example: 'Bought with the cover' })
  notes?: string | null;

  @ApiProperty({ description: 'Owner who saved it.', example: 'user-uuid' })
  createdById: string;

  @ApiProperty({ example: '2026-10-07T09:20:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-07T09:20:00.000Z' })
  updatedAt: Date;

  @ApiProperty({ type: [ResponseSaleItemDto] })
  items: ResponseSaleItemDto[];

  @ApiProperty({
    description: 'Payments recorded against this sale (empty for full Udhar).',
    type: [ResponsePaymentDto],
  })
  payments: ResponsePaymentDto[];

  @ApiProperty({
    description:
      'Returns recorded against this sale (WF15, empty for most sales). A sale with returns can no longer be cancelled.',
    type: [ResponseReturnDto],
  })
  returns: ResponseReturnDto[];
}

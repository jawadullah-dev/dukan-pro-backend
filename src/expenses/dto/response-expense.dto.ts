import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResponseExpenseDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000301' })
  id: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000000' })
  shopId: string;

  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000101' })
  categoryId: string;

  @ApiProperty({ example: 'Electricity' })
  categoryName: string;

  @ApiProperty({
    description: 'Amount paid, in PAISA.',
    example: 500000,
  })
  amount: number;

  @ApiProperty({ description: 'YYYY-MM-DD.', example: '2026-10-06' })
  expenseDate: string;

  @ApiPropertyOptional({ example: 'October electricity bill' })
  description: string | null;

  @ApiProperty({ example: 'ACTIVE' })
  status: string;

  @ApiPropertyOptional({ example: null })
  cancelledAt: Date | null;

  @ApiPropertyOptional({ example: null })
  cancelReason: string | null;

  @ApiPropertyOptional({ example: null })
  cancelledById: string | null;

  @ApiProperty({ example: 'user-uuid' })
  createdById: string;

  @ApiProperty({ example: '2026-10-06T09:20:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-06T09:20:00.000Z' })
  updatedAt: Date;
}

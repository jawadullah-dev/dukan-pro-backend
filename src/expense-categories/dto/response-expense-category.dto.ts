import { ApiProperty } from '@nestjs/swagger';

/**
 * Output DTO returned by GET endpoints. Shape mirrors the Prisma row; we do not
 * expose it directly so future fields can be scrubbed here without breaking the
 * frontend.
 */
export class ResponseExpenseCategoryDto {
  @ApiProperty({
    description: 'UUID v7 of this expense category row.',
    example: '01924f0a-0000-0000-0000-000000000000',
  })
  id: string;

  @ApiProperty({
    description:
      'Shop that owns this expense category. Every expense category is scoped per-tenant.',
    example: '01924f0a-0000-0000-0000-000000000000',
  })
  shopId: string;

  @ApiProperty({ example: 'Electricity' })
  name: string;

  @ApiProperty({
    example: true,
    description: 'Deactivated categories are hidden from dropdowns.',
  })
  isActive: boolean;

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

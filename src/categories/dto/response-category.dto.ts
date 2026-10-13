import { ApiProperty } from '@nestjs/swagger';

/**
 * Output DTO returned by GET endpoints. Shape mirrors the Prisma row; we do not
 * expose it directly because future fields (e.g. internal counters, audit fields)
 * can be scrubbed here without breaking the frontend.
 */
export class ResponseCategoryDto {
  @ApiProperty({
    description: 'UUID v7 of this category row.',
    example: '01924f0a-0000-0000-0000-000000000000',
  })
  id: string;

  @ApiProperty({
    description:
      'Shop that owns this category. Every category is scoped per-tenant.',
    example: '01924f0a-0000-0000-0000-000000000000',
  })
  shopId: string;

  @ApiProperty({ example: 'Mobile Phones' })
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

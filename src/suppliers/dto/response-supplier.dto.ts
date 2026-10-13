import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Output DTO returned by GET endpoints. Mirrors the Prisma row exactly —
 * suppliers have no joined children and no stock counter to resolve.
 */
export class ResponseSupplierDto {
  @ApiProperty({
    description: 'UUID v7 of this supplier row.',
    example: '01924f0a-0000-7000-8000-00000000000a',
  })
  id: string;

  @ApiProperty({
    description:
      'Shop that owns this supplier. Every supplier is scoped per-tenant.',
    example: '01924f0a-0000-7000-8000-000000000000',
  })
  shopId: string;

  @ApiProperty({ example: 'ABC Mobiles, Peshawar' })
  name: string;

  @ApiPropertyOptional({
    description:
      'Pakistani mobiles normalised to 923XXXXXXXXX; otherwise as typed.',
    example: '923001234567',
  })
  phone?: string | null;

  @ApiPropertyOptional({ example: 'Suite 4, Hall Road, Lahore' })
  address?: string | null;

  @ApiPropertyOptional({ example: 'Only sells original chargers' })
  notes?: string | null;

  @ApiProperty({
    description:
      'What you already owed this supplier before Dukaan Pro, in PAISA (Rs 1 = 100 paisa).',
    example: 5000000,
  })
  openingBalance: number;

  @ApiProperty({
    description:
      'true = the onboarding-created "Walk-in seller". Cannot be renamed or deactivated.',
    example: false,
  })
  isSystem: boolean;

  @ApiProperty({
    description:
      'Deactivated suppliers are hidden from pickers but kept for history on old purchases.',
    example: true,
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

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Output DTO for the shop's own store settings (owner surface). Mirrors the
 * Prisma row so the owner can read back exactly what is configured.
 */
export class ResponseStoreSettingsDto {
  @ApiProperty({
    description:
      'The shop this settings row belongs to (same as the JWT shop).',
    example: '01924f0a-0000-7000-8000-000000000000',
  })
  shopId: string;

  @ApiProperty({
    description: 'Store address, unique across all of Dukaan Pro.',
    example: 'khalid-mobile',
  })
  slug: string;

  @ApiProperty({
    description:
      'Master switch. The public store 404s until the owner turns this on.',
    example: false,
  })
  isEnabled: boolean;

  @ApiProperty({ description: 'Store name shown on the storefront.' })
  displayName: string;

  @ApiPropertyOptional({ description: 'Short intro story for customers.' })
  about?: string | null;

  @ApiPropertyOptional({ description: 'Logo image URL.' })
  logoUrl?: string | null;

  @ApiPropertyOptional({ description: 'Cover banner image URL.' })
  bannerUrl?: string | null;

  @ApiPropertyOptional({
    description: 'WhatsApp number (international digits).',
  })
  whatsappNumber?: string | null;

  @ApiPropertyOptional({ description: 'Display phone number.' })
  phoneNumber?: string | null;

  @ApiPropertyOptional({ description: 'Street address.' })
  address?: string | null;

  @ApiPropertyOptional({ description: 'City.' })
  city?: string | null;

  @ApiPropertyOptional({ description: 'Google Maps link.' })
  googleMapsUrl?: string | null;

  @ApiPropertyOptional({ description: 'Opening hours text.' })
  openingHours?: string | null;

  @ApiPropertyOptional({ description: 'Facebook page URL.' })
  facebookUrl?: string | null;

  @ApiPropertyOptional({ description: 'Instagram profile URL.' })
  instagramUrl?: string | null;

  @ApiProperty({
    description:
      'false = storefront says only "In stock / Low / Out"; true = exact number.',
    example: false,
  })
  showExactStock: boolean;

  @ApiProperty({ description: 'Row creation timestamp, UTC.' })
  createdAt: Date;

  @ApiProperty({ description: 'Last edit timestamp, UTC.' })
  updatedAt: Date;
}

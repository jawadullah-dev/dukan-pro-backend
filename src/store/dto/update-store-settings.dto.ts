import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * Owner edits the store's public face. All fields optional (partial edit).
 * `null` is legal on every nullable column to clear it; the service rejects
 * `null` on the non-nullable displayName. URL formats mirror the DB CHECKs so
 * a bad value is a friendly 400, not a raw constraint error.
 *
 * `slug` is deliberately ABSENT: the owner cannot change the store address
 * (shared links and QR codes would break) — only a platform admin can, via
 * PATCH /platform-admin/shops/{id}/store-slug (WF19 step 2).
 */
export class UpdateStoreSettingsDto {
  @ApiPropertyOptional({
    description: 'Master switch. The public store is a 404 until this is true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Store name shown on the storefront (2–100 chars).',
    example: 'Khalid Mobile Center',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @Length(2, 100)
  displayName?: string | null;

  @ApiPropertyOptional({
    description: 'Short intro story customers read on the storefront.',
    example: 'Genuine phones with warranty since 2015.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  about?: string | null;

  @ApiPropertyOptional({
    description:
      'Logo image URL. http(s) only — javascript: links are blocked.',
    example: 'https://cdn.example.com/logo.png',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @Matches(/^https?:\/\//i)
  logoUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Cover banner image URL. http(s) only.',
    example: 'https://cdn.example.com/banner.png',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @Matches(/^https?:\/\//i)
  bannerUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'WhatsApp number in international digits: 923001234567 (10–15 digits).',
    example: '923001234567',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @Matches(/^[0-9]{10,15}$/i)
  whatsappNumber?: string | null;

  @ApiPropertyOptional({
    description: 'Display phone number (free text allowed).',
    example: '0300-1234567',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 30)
  phoneNumber?: string | null;

  @ApiPropertyOptional({
    description: 'Street address shown on the storefront.',
    example: 'Shop 12, Shahra-e-Faisal, Karachi',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 300)
  address?: string | null;

  @ApiPropertyOptional({ description: 'City.', example: 'Karachi' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string | null;

  @ApiPropertyOptional({
    description: 'Google Maps link for directions. http(s) only.',
    example: 'https://maps.google.com/?q=24.86,67.03',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @Matches(/^https?:\/\//i)
  googleMapsUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Opening hours, free text.',
    example: 'Mon–Sat 11:00–21:00',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(1, 200)
  openingHours?: string | null;

  @ApiPropertyOptional({
    description: 'Facebook page URL. http(s) only.',
    example: 'https://facebook.com/khalid.mobile',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @Matches(/^https?:\/\//i)
  facebookUrl?: string | null;

  @ApiPropertyOptional({
    description: 'Instagram profile URL. http(s) only.',
    example: 'https://instagram.com/khalid.mobile',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @Matches(/^https?:\/\//i)
  instagramUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'When true the storefront shows the exact on-hand number; when false it only says In stock / Low / Out.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  showExactStock?: boolean;
}

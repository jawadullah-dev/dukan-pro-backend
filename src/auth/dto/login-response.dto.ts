import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums.js';

export class OwnerLoginUserDto {
  @ApiProperty({ example: '01924f0a-0000-0000-0000-000000000000' })
  id: string;

  @ApiProperty({ example: 'Ali Khan' })
  name: string;

  @ApiProperty({
    example: '923001234567',
    description: 'Normalised login phone, E.164 without "+".',
  })
  phone: string;

  @ApiProperty({ enum: UserRole, example: UserRole.OWNER })
  role: UserRole;
}

export class OwnerLoginShopDto {
  @ApiProperty({ example: 'Al-Madina Mobile' })
  name: string;

  @ApiProperty({
    example: '2026-11-05T09:20:00.000Z',
    description:
      'Subscription end. The backend blocks every request once this passes, so the app can warn the owner before expiry.',
  })
  subscriptionEndsAt: Date;
}

/**
 * Owner login response. Also the shape of the JWT payload, minus the token
 * itself — the frontend can trust `shopId` here because the backend never
 * accepts a shopId from the client (CLAUDE.md Rule 2).
 */
export class OwnerLoginResponseDto {
  @ApiProperty({
    description: 'Signed JWT. Send as `Authorization: Bearer <token>`.',
  })
  accessToken: string;

  @ApiProperty({ example: 'Bearer', description: 'Always "Bearer".' })
  tokenType: string;

  @ApiProperty({
    example: '24h',
    description: 'How long the token stays valid, matching JWT_EXPIRES_IN.',
  })
  expiresIn: string;

  @ApiProperty({ description: 'The logged-in owner.' })
  user: OwnerLoginUserDto;

  @ApiProperty({
    example: '01924f0a-0000-0000-0000-000000000000',
    description:
      'Shop the token is scoped to. Every request with this token is filtered to this shop.',
  })
  shopId: string;

  @ApiProperty({ description: 'Short shop summary for the app header.' })
  shop: OwnerLoginShopDto;
}

export class PlatformAdminSummaryDto {
  @ApiProperty({ example: '01924f0a-0000-0000-0000-000000000000' })
  id: string;

  @ApiProperty({ example: 'Dukaan Pro Support' })
  name: string;

  @ApiProperty({ example: '923001234567' })
  phone: string;
}

/**
 * Platform admin login response. No shopId — admins operate outside tenants.
 */
export class PlatformAdminLoginResponseDto {
  @ApiProperty({
    description: 'Signed JWT. Send as `Authorization: Bearer <token>`.',
  })
  accessToken: string;

  @ApiProperty({ example: 'Bearer', description: 'Always "Bearer".' })
  tokenType: string;

  @ApiProperty({ example: '24h' })
  expiresIn: string;

  @ApiProperty({ description: 'The logged-in admin.' })
  admin: PlatformAdminSummaryDto;
}

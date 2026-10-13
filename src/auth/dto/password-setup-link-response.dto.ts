import { ApiProperty } from '@nestjs/swagger';

/**
 * Returned ONCE, immediately after the platform admin asks for a setup link.
 *
 * Dukaan Pro sends no email and no SMS: the admin copies this URL out of the
 * panel and forwards it to the shop owner on WhatsApp. The plaintext token
 * exists only in this response — the database keeps a SHA-256 hash, so a lost
 * link can never be recovered. Re-issue a new link instead.
 */
export class PasswordSetupLinkResponseDto {
  @ApiProperty({
    example: '01924f0a-0000-0000-0000-000000000000',
    description: 'Owner whose password will be set by this link.',
  })
  userId: string;

  @ApiProperty({ example: 'Ali Khan' })
  userName: string;

  @ApiProperty({
    example: '923001234567',
    description: 'Normalised phone, so the admin can confirm the right owner.',
  })
  userPhone: string;

  @ApiProperty({
    example: '2026-10-07T09:20:00.000Z',
    description:
      'When this link stops working. After this moment the token is treated as invalid.',
  })
  expiresAt: Date;

  @ApiProperty({
    example:
      'http://localhost:3000/setup-password?token=9f2c1a4b7e6d5c8a0b1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99',
    description:
      'Complete URL to send to the owner on WhatsApp. Opening it once and choosing a password immediately invalidates the token.',
  })
  setupUrl: string;

  @ApiProperty({
    example: false,
    description:
      'True when this replaced an unused earlier link — the previous token stopped working.',
  })
  replacedPreviousLink: boolean;
}

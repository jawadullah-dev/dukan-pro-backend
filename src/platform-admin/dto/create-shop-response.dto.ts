import { ApiProperty } from '@nestjs/swagger';
import { ShopStatus } from '../../generated/prisma/enums.js';

/** How many starter rows onboarding copied into the new shop. */
export class OnboardedDefaultsDto {
  @ApiProperty({ example: 7 })
  categories: number;

  @ApiProperty({
    example: 0,
    description:
      'Intentionally zero — phone brands go stale, so the owner adds their own.',
  })
  brands: number;

  @ApiProperty({ example: 8 })
  expenseCategories: number;

  @ApiProperty({
    example: 1,
    description: 'The protected "Walk-in seller" supplier (is_system = true).',
  })
  suppliers: number;
}

/** Automatic number counters, already at their starting value. */
export class ShopCountersDto {
  @ApiProperty({
    example: 1,
    description: 'Next sale number. The first sale will be S-0001.',
  })
  nextSaleNo: number;

  @ApiProperty({
    example: 1,
    description: 'Next purchase number. The first purchase will be P-0001.',
  })
  nextPurchaseNo: number;
}

/**
 * WF1 result. The admin needs three things from one call: the shop id (to
 * manage it later), the owner id (to reissue a setup link if the owner loses it)
 * and the setup link to forward on WhatsApp.
 */
export class CreateShopResponseDto {
  @ApiProperty({ example: '01924f0a-0000-0000-0000-000000000000' })
  shopId: string;

  @ApiProperty({ example: 'Khalid Mobile Center' })
  shopName: string;

  @ApiProperty({ example: '01924f0a-0000-0000-0000-000000000000' })
  ownerId: string;

  @ApiProperty({ example: 'Khalid Mehmood' })
  ownerName: string;

  @ApiProperty({
    example: '923001234567',
    description: 'Normalised owner phone — this is the login id.',
  })
  ownerPhone: string;

  @ApiProperty({
    example:
      'http://localhost:3000/setup-password?token=9f2c1a4b7e6d5c8a0b1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99',
    description:
      'Complete URL to send to the owner on WhatsApp. Shown ONCE — only a hash is stored, so it cannot be retrieved later. Reissue a new link if lost.',
  })
  setupUrl: string;

  @ApiProperty({
    example: '2026-10-07T09:20:00.000Z',
    description: 'When the setup link stops working.',
  })
  setupLinkExpiresAt: Date;

  @ApiProperty({ description: 'What the onboarding automatically copied in.' })
  defaults: OnboardedDefaultsDto;

  @ApiProperty({ description: 'Automatic number counters.' })
  counters: ShopCountersDto;

  @ApiProperty({ enum: ShopStatus, example: ShopStatus.ACTIVE })
  status: ShopStatus;
}

import { ApiProperty } from '@nestjs/swagger';
import { ShopStatus } from '../../generated/prisma/enums.js';

/** WF3 result — confirms the new subscription window and access state. */
export class UpdateSubscriptionResponseDto {
  @ApiProperty({ example: '01924f0a-0000-0000-0000-000000000000' })
  shopId: string;

  @ApiProperty({ example: 'Khalid Mobile Center' })
  shopName: string;

  @ApiProperty({ enum: ShopStatus, example: ShopStatus.ACTIVE })
  status: ShopStatus;

  @ApiProperty({ example: '2026-12-05T00:00:00.000Z' })
  subscriptionEndsAt: Date;

  @ApiProperty({
    example: true,
    description:
      'Whether the shop can work right now: status ACTIVE and the subscription has not expired.',
  })
  isAccessible: boolean;
}

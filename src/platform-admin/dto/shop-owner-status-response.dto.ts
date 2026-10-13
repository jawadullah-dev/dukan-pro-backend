import { ApiProperty } from '@nestjs/swagger';

/** GET /platform-admin/shops/:id — enough to decide the admin's next action. */
export class ShopOwnerStatusResponseDto {
  @ApiProperty({ example: '01924f0a-0000-0000-0000-000000000000' })
  shopId: string;

  @ApiProperty({
    example: true,
    description:
      'False means the shop exists but nobody can log in yet — issue a setup link.',
  })
  hasOwner: boolean;

  @ApiProperty({
    example: 'Khalid Mehmood',
    nullable: true,
    description: 'Null when the shop has no owner yet.',
  })
  ownerName: string | null;

  @ApiProperty({
    example: '923001234567',
    nullable: true,
    description: 'Normalised owner phone — the login id.',
  })
  ownerPhone: string | null;

  @ApiProperty({
    example: false,
    description:
      'False until the owner opens the setup link and chooses a password. Reissue the link if an owner has not set one within the token lifetime.',
  })
  hasPassword: boolean;
}

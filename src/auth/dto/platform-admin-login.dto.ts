import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * Platform admins sign in separately from shop owners. They live in
 * `platform_admins`, which has no `shop_id`, so there is no risk of an admin
 * token being mistaken for an owner token (see AuthTokenType).
 */
export class PlatformAdminLoginDto {
  @ApiProperty({
    description: 'Dukaan Pro staff mobile number.',
    example: '03001234567',
  })
  @IsString()
  @IsNotEmpty()
  @Length(10, 20)
  phone: string;

  @ApiProperty({ description: 'Admin password.', example: 'AdminOwner1' })
  @IsString()
  @IsNotEmpty()
  @Length(8, 72)
  password: string;
}

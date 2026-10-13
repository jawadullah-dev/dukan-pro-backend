import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

/**
 * WF1 steps 1 and 2 in one call.
 *
 * The admin enters the shop and the owner together, because a shop without an
 * owner is an unusable tenant — nobody could ever log in to it. The owner picks
 * his own password later via the returned setup link, so the admin never handles
 * or sees it.
 */
export class CreateShopDto {
  @ApiProperty({
    description: 'Shop name as the owner writes it on his signboard.',
    example: 'Khalid Mobile Center',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 150)
  shopName: string;

  @ApiPropertyOptional({
    description: 'Shop contact number. Any format is accepted.',
    example: '03001234567',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(7, 20)
  shopPhone?: string;

  @ApiPropertyOptional({
    description: 'Shop address, shown on receipts.',
    example: 'Main Bazaar, Lahore',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 250)
  shopAddress?: string;

  @ApiProperty({
    description:
      'When the subscription ends. After this moment every request is blocked with "subscription has ended". Must be in the future.',
    example: '2026-11-05',
  })
  @IsDateString()
  subscriptionEndsAt: string;

  @ApiProperty({
    description: "Owner's full name. Used on receipts and in the app header.",
    example: 'Khalid Mehmood',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  ownerName: string;

  @ApiProperty({
    description:
      "Owner's mobile number. This is the login identity and it is unique across the whole platform — if it already belongs to another shop, creation fails.",
    example: '03001234567',
  })
  @IsString()
  @Length(10, 20)
  ownerPhone: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * Phone is the login identity for shop owners — `users.phone` is unique across
 * the whole platform.
 *
 * Any common spelling is accepted ("0300-1234567", "+92 300 1234567"); the
 * service normalises it to `923001234567` before querying.
 */
export class OwnerLoginDto {
  @ApiProperty({
    description:
      'Shop owner mobile number in any format: 03001234567, 0300-1234567 or +923001234567.',
    example: '03001234567',
  })
  @IsString()
  @IsNotEmpty()
  @Length(10, 20)
  phone: string;

  @ApiProperty({
    description:
      'Password the owner chose on the setup link. Minimum 8 characters.',
    example: 'DukaanOwner1',
  })
  @IsString()
  @IsNotEmpty()
  @Length(8, 72)
  password: string;
}

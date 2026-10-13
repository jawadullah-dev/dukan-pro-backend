import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

/**
 * Self-service password change for an already-logged-in owner.
 *
 * Requires the current password on purpose: a stolen token alone is not enough
 * to lock the real owner out.
 */
export class ChangePasswordDto {
  @ApiProperty({
    description: 'The password currently in use for this account.',
    example: 'DukaanOwner1',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 72)
  currentPassword: string;

  @ApiProperty({
    description:
      'New password. 8 to 72 characters, at least one letter and one digit.',
    example: 'DukaanOwner2',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @IsNotEmpty()
  @Length(8, 72, {
    message:
      'password must be between 8 and 72 characters (72 is the bcrypt limit)',
  })
  @Matches(/[A-Za-z]/, { message: 'password must contain at least one letter' })
  @Matches(/\d/, { message: 'password must contain at least one digit' })
  newPassword: string;
}

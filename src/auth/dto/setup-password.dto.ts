import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

/**
 * Password policy for shop owners.
 *
 * Owners are not tech users, so this is deliberately light: 8+ characters with
 * at least one letter and one digit. No forced symbols, no uppercase rule,
 * no expiry — a weak-but-memorable password the owner actually remembers is
 * far better than a strong one written on a sticky note.
 *
 * Every field is validated here rather than in the service, so the ValidationPipe
 * rejects it before any database work happens.
 */
export class SetupPasswordDto {
  @ApiProperty({
    description:
      'One-time token from the setup link. The backend stores only its SHA-256 hash, so the plaintext exists only inside the link.',
    example: '9f2c1a4b7e6d5c8a0b1f2e3d4c5b6a79887766554433221100ffeeddccbbaa99',
  })
  @IsString()
  @IsNotEmpty()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/, {
    message: 'token must be a 64 character lowercase hex string',
  })
  token: string;

  @ApiProperty({
    description:
      "New password. 8 to 72 characters, at least one letter and one digit. The 72 character ceiling is bcrypt's — anything past 72 bytes is silently ignored by the hash.",
    example: 'DukaanOwner1',
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
  password: string;
}

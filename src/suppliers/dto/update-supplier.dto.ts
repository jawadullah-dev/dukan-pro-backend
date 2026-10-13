import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { normalizePhoneOrRaw } from '../../helpers/phone.helper.js';

/**
 * Every updatable field is explicitly listed as optional. We deliberately do NOT
 * use PartialType so each field stays a strict opt-in for edit endpoints.
 *
 * `isSystem` is absent on purpose: it is never client-settable. The service also
 * refuses a rename or a deactivation of the system "Walk-in seller" row.
 */
export class UpdateSupplierDto {
  @ApiPropertyOptional({
    description:
      'New supplier name. Blocked for the system "Walk-in seller" row (403).',
    example: 'ABC Mobiles (Peshawar) updated',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @ApiPropertyOptional({ example: '03001234567' })
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizePhoneOrRaw(value.trim()) : value,
  )
  @IsOptional()
  @IsString()
  @Length(1, 30)
  phone?: string;

  @ApiPropertyOptional({
    example: 'Suite 4, Hall Road, Lahore',
    maxLength: 300,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 300)
  address?: string;

  @ApiPropertyOptional({
    example: 'Only sells original chargers',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Correction to the Day-0 owed amount, in PAISA. Cannot be negative.',
    example: 5000000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  openingBalance?: number;

  @ApiPropertyOptional({
    description:
      'Set false to hide the supplier without deleting it. Blocked for the system "Walk-in seller" row (403).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

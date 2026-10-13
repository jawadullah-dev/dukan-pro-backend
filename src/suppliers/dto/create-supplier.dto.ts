import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateSupplierDto {
  @ApiProperty({
    description:
      'Supplier name, e.g. "ABC Mobiles, Preshawar". Not unique — the database deliberately allows two suppliers with the same name.',
    example: 'ABC Mobiles, Peshawar',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 150)
  name: string;

  @ApiPropertyOptional({
    description:
      'Contact number. Pakistani mobiles are normalised to 923XXXXXXXXX; any other spelling is stored as typed rather than rejected.',
    example: '03001234567',
  })
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
      'What you already owed this supplier before Dukaan Pro — Day-0 data. In PAISA (Rs 50,000 = 5000000). Integer, cannot be negative.',
    example: 5000000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  openingBalance?: number;

  @ApiPropertyOptional({
    description: 'Set false to hide the supplier without deleting it.',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

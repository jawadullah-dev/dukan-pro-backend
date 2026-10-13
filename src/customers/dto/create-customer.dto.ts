import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({
    description:
      'Customer name. Not unique: two customers can share a name. Walk-in sales use no customer at all.',
    example: 'Ali Khan',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({
    description:
      'Customer phone. Optional, stored in canonical form (03001234567 → 923001234567) so search finds it either way.',
    example: '03001234567',
    required: false,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(7, 20)
  phone?: string;

  @ApiProperty({
    description: 'Customer address.',
    example: 'Hayatabad, Peshawar',
    required: false,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiProperty({
    description: 'Free-text notes about the customer.',
    example: 'Regular customer, pays at month end',
    required: false,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({
    description:
      'Old Udhar the customer already owed before using the app, in paisa (Rs 100 = 10000). Cannot be negative. Can only be set when the customer is created.',
    example: 5000000,
    default: 0,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  openingBalance?: number;

  @ApiProperty({
    description:
      'When false the owner can hide the customer from selection dropdown but historical sales keep it.',
    example: true,
    default: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

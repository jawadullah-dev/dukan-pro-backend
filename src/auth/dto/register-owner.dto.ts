import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterOwnerDto {
  @ApiPropertyOptional({ example: 'Muhammad Ali', description: 'Full name of the shop owner.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ example: 'Muhammad Ali', description: 'Full name of the shop owner (alias).' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ example: '03001234567', description: 'Mobile phone number of the shop owner.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  phone: string;

  @ApiProperty({ example: 'Password123!', description: 'Owner account password.' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password: string;

  @ApiProperty({ example: 'Ali Mobile Store', description: 'Name of the shop.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  shopName: string;

  @ApiPropertyOptional({ example: 'Lahore', description: 'City where the shop is located.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'Shop 12, Hafeez Centre, Lahore', description: 'Street address of the shop.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: 'Shop 12, Hall Road, Lahore', description: 'Street address of the shop (alias).' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(300)
  shopAddress?: string;

  @ApiPropertyOptional({ example: '03001234567', description: 'Contact phone number of the shop.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(30)
  shopPhone?: string;
}

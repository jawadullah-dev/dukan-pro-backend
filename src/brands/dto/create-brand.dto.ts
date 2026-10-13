import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CreateBrandDto {
  @ApiProperty({
    description:
      'Brand name shown on purchase screen. Unique inside a single shop (case-sensitive).',
    example: 'Samsung',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({
    description:
      'When false the owner can hide the brand from selection dropdown but historical products attached it.',
    example: true,
    default: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

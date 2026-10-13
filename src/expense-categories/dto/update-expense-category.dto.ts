import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

/**
 * Every updatable field is explicitly listed as optional.
 * We deliberately do NOT use PartialType because we want strict
 * opt-in on a field-by-field basis for edit endpoints.
 */
export class UpdateExpenseCategoryDto {
  @ApiPropertyOptional({
    description:
      'New expense category name. Must still be unique within the shop.',
    example: 'Shop Rent',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Toggle category visibility in lists. Deactivated categories are hidden but kept for history.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

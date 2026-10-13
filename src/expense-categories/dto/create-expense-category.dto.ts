import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CreateExpenseCategoryDto {
  @ApiProperty({
    description:
      'Expense category name shown in the expense category dropdown (Rent, Electricity...). Unique inside a single shop (case-sensitive).',
    example: 'Electricity',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({
    description:
      'When false the owner can hide the category from the selection dropdown, but historical expenses keep it.',
    example: true,
    default: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

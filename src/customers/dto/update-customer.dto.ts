import { ApiPropertyOptional } from '@nestjs/swagger';
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

/**
 * Every updatable field is explicitly listed as optional.
 * We deliberately do NOT use PartialType because we want strict
 * opt-in on a field-by-field basis for edit endpoints.
 *
 * Null on `phone` / `address` / `notes` clears the column (they are nullable).
 * Null on `name` is rejected by the service: name is required and non-nullable.
 *
 * `openingBalance` IS updatable — it is Day-0 data (WF1: "Old customer Udhar →
 * PATCH /customers/:id"). Payments never touch this column; they apply against
 * the calculated balance, so correcting it later is safe.
 */
export class UpdateCustomerDto {
  @ApiPropertyOptional({
    description: 'New customer name.',
    example: 'Ali Raza',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({
    description:
      'New customer phone, stored in canonical form. Send null to clear it.',
    example: '03007654321',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(7, 20)
  phone?: string;

  @ApiPropertyOptional({
    description: 'New customer address.',
    example: 'University Town, Peshawar',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({
    description: 'New notes about the customer.',
    example: 'Prefers WhatsApp reminders',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'Correct the Day-0 Udhar (old amount owed before the app), in paisa. Cannot be negative or fractional. Current Udhar is always calculated from sales and payments — this only changes the starting figure.',
    example: 5000000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  openingBalance?: number;

  @ApiPropertyOptional({
    description:
      'Toggle customer visibility in lists. Deactivated customers are hidden but kept for history.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

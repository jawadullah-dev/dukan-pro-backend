import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CancelPaymentDto {
  @ApiProperty({
    description:
      'Why this payment is being cancelled. Required and non-empty — a cancellation with no reason is a lie in the ledger.',
    example: 'Customer paid the wrong bill',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000)
  cancelReason: string;

  @ApiPropertyOptional({
    description:
      'Set true only after the server answered with confirmOverdraft — cancelling a payment hands the money back, and the owner accepted the warning that the drawer would go below zero.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CancelSaleDto {
  @ApiProperty({
    description:
      'Why this sale is being cancelled. Required and non-empty — a cancellation with no reason is a lie in the ledger.',
    example: 'Wrong IMEI entered',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000)
  cancelReason: string;

  @ApiPropertyOptional({
    description:
      'Set true only after the server answered with confirmOverdraft — cancelling this sale refunds its payments in cash, and the owner accepted the warning that the drawer would go below zero.',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  confirmOverdraft?: boolean;
}

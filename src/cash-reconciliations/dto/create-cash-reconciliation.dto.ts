import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateCashReconciliationDto {
  @ApiProperty({
    description:
      'Real cash physically counted in the drawer, in PAISA. Rs 478,500 = 47850000. Zero is legal (an empty drawer).',
    example: 47850000,
  })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  countedCash: number;

  @ApiPropertyOptional({
    description:
      'Required ONLY when countedCash differs from the system cash. Stored so the difference can be explained later.',
    example: 'Wrong change given',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  reason?: string;
}

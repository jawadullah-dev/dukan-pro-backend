import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CancelExpenseDto {
  @ApiProperty({
    description:
      'Why this expense is being cancelled. Required and non-empty — a cancellation with no reason is a lie in the ledger.',
    example: 'Entered twice by mistake',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000)
  cancelReason: string;
}

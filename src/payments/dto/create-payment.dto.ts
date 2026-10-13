import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({
    description:
      'Double-tap protection. Generate ONE uuid per opened Save screen and reuse it if the request is retried. If this id was already saved the system returns success instead of recording a second payment.',
    example: '01924f0a-0000-7000-8000-00000000beef',
  })
  @IsUUID()
  clientRequestId: string;

  @ApiProperty({
    description:
      'Who is paying. The system calculates their outstanding Udhar and rejects anything larger.',
    example: '01924f0a-0000-7000-8000-0000000000a7',
  })
  @IsUUID()
  customerId: string;

  @ApiProperty({
    description:
      "Amount received, in PAISA. Must be more than 0 and not more than the customer's total outstanding (opening balance + unpaid sales).",
    example: 500000,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  amount: number;

  @ApiProperty({
    description: 'Day the money was received, as YYYY-MM-DD.',
    example: '2026-10-07',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  paymentDate: string;

  @ApiPropertyOptional({
    description:
      'Pay specific sales instead of the default oldest-first rule. Every id must be an unpaid sale of this customer. When salesIds is sent the opening balance is never touched — you named sales, the money goes to those sales. Omit to apply oldest-first: opening balance, then sales by date.',
    type: [String],
    example: ['01924f0a-0000-7000-8000-0000000001c1'],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  salesIds?: string[];

  @ApiPropertyOptional({
    description:
      'How the money arrived. Only CASH exists in the MVP — omit to take the default.',
    enum: ['CASH'],
    default: 'CASH',
  })
  @IsOptional()
  @IsIn(['CASH'])
  method?: 'CASH';

  @ApiPropertyOptional({
    example: 'Part of the laptop money',
    maxLength: 1000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

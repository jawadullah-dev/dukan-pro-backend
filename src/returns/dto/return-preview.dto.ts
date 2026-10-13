import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ReturnItemDto } from './return-item.dto.js';

/**
 * Step 4 of WF15 — the owner sees how the value settles BEFORE saving.
 * Same line rules as CreateReturnDto (it is a dry run of the same save),
 * but reason/returnDate are not needed yet.
 */
export class ReturnPreviewDto {
  @ApiProperty({
    description:
      'Lines being returned — identical to what you would POST to save.',
    type: [ReturnItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @ApiPropertyOptional({
    description:
      'Refund you are considering, in PAISA, to preview its cash effect.',
    example: 70000,
    default: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  refundAmount?: number;
}

/** One line of the preview, as the settlement sees it. */
export class ReturnPreviewLineDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-000000000201' })
  saleItemId: string;

  @ApiProperty({ example: 'Samsung A15 128GB' })
  productName: string;

  @ApiPropertyOptional({
    description: 'Phone lines only.',
    example: '111223344556677',
  })
  imei?: string | null;

  @ApiProperty({ example: 1 })
  quantity: number;

  @ApiProperty({ enum: ['GOOD', 'DAMAGED'], example: 'GOOD' })
  condition: string;
}

export class ReturnPreviewResponseDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-0000000000aa' })
  saleId: string;

  @ApiProperty({ example: 'S-0001' })
  saleNo: string;

  @ApiPropertyOptional({
    description: 'null = walk-in cash sale.',
    example: 'Ali Khan',
  })
  customerName?: string | null;

  @ApiProperty({
    description:
      "Value of this return in PAISA: Σ quantity × unitPrice minus this return's pro-rata share of the sale discount. Computed by the server, never sent.",
    example: 10000000,
  })
  returnAmount: number;

  @ApiProperty({
    description:
      'What the customer still owes on this sale right now, in PAISA (total − returns − active payments + refunds).',
    example: 3000000,
  })
  outstandingBefore: number;

  @ApiProperty({
    description: 'Outstanding once this return is saved, in PAISA.',
    example: 0,
  })
  outstandingAfter: number;

  @ApiProperty({
    description:
      'Maximum cash that can be refunded with this return, in PAISA: the return value minus the Udhar it cancels, capped by what was actually paid (minus earlier refunds).',
    example: 7000000,
  })
  refundable: number;

  @ApiProperty({
    description:
      'The refundAmount you sent, in PAISA. 0 = keep it all as Udhar relief.',
    example: 7000000,
  })
  refundAmount: number;

  @ApiProperty({
    description: 'Drawer balance now, in PAISA.',
    example: 15000000,
  })
  currentCash: number;

  @ApiProperty({
    description: 'Drawer balance after the refund, in PAISA.',
    example: 8000000,
  })
  cashAfter: number;

  @ApiProperty({
    description:
      'True when the refund would take cash below zero — the save will prompt first.',
    example: false,
  })
  willCauseOverdraft: boolean;

  @ApiProperty({ type: [ReturnPreviewLineDto] })
  items: ReturnPreviewLineDto[];
}

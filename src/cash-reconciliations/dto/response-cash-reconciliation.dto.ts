import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Matches the cash_reconciliations row, paisa BIGINTs as numbers. */
export class ResponseCashReconciliationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  shopId: string;

  @ApiProperty({ description: 'System cash = SUM(IN) − SUM(OUT), in paisa.' })
  systemCash: number;

  @ApiProperty({ description: 'Cash the owner counted, in paisa.' })
  countedCash: number;

  @ApiProperty({
    description: 'counted − system, in paisa. Sign shows direction.',
  })
  difference: number;

  @ApiPropertyOptional()
  reason: string | null;

  @ApiProperty()
  reconciledAt: Date;

  @ApiProperty()
  createdById: string;
}

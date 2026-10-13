import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One line of a customer or supplier ledger (WF11). There is no ledger table —
 * the timeline is built from the real sale / purchase / payment rows — so a
 * cancelled record stays visible as a line with delta 0 and does not move the
 * running balance.
 */
export class LedgerEntryDto {
  @ApiProperty({
    description: 'The sale / purchase / payment row this line came from.',
    example: '01924f0a-0000-7000-8000-000000000101',
  })
  id: string;

  @ApiProperty({
    description:
      'SALE | PAYMENT | RETURN | REFUND on a customer ledger, PURCHASE | SUPPLIER_PAYMENT on a supplier ledger.',
    example: 'SALE',
  })
  type: string;

  @ApiProperty({
    description:
      'ISO-8601 for sales and customer payments; YYYY-MM-DD business date for purchases and supplier payments.',
    example: '2026-10-05T09:00:00.000Z',
  })
  date: string;

  @ApiPropertyOptional({
    description:
      'S-0001 / P-0003. null for a payment made against the opening balance.',
    example: 'S-0001',
  })
  reference?: string | null;

  @ApiPropertyOptional({
    description: 'Notes copied from the original record.',
    example: 'Part payment at the counter',
  })
  notes?: string | null;

  @ApiProperty({
    description: 'What the record itself says, in PAISA.',
    example: 10000000,
  })
  amount: number;

  @ApiProperty({
    description:
      'Effect on the balance in PAISA: + for a sale/purchase/refund, − for a payment/return, 0 when CANCELLED.',
    example: 10000000,
  })
  delta: number;

  @ApiProperty({
    description: 'Running balance after this line, in PAISA.',
    example: 15000000,
  })
  balance: number;

  @ApiProperty({
    description: 'ACTIVE rows count, CANCELLED ones do not.',
    example: 'ACTIVE',
  })
  status: string;
}

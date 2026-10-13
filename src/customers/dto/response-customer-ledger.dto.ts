import { ApiProperty } from '@nestjs/swagger';
import { LedgerEntryDto } from '../../common-dto/response/ledger-entry.dto.js';

/** WF11 — why a customer owes what they owe. */
export class CustomerLedgerDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-0000000000b1' })
  customerId: string;

  @ApiProperty({ example: 'Ali Khan' })
  customerName: string;

  @ApiProperty({
    description:
      'Day-0 Udhar typed in at onboarding. Never edited by payments.',
    example: 5000000,
  })
  openingBalance: number;

  @ApiProperty({
    description:
      'Current Udhar: openingBalance + Σ ACTIVE sales − Σ ACTIVE payments. Cancelled rows are shown but never counted. Derived on read, never stored.',
    example: 3000000,
  })
  balance: number;

  @ApiProperty({ description: 'Current page number (1-based)', example: 1 })
  page: number;

  @ApiProperty({ description: 'Rows requested per page', example: 50 })
  pageSize: number;

  @ApiProperty({
    description: 'Timeline lines across all pages, oldest first.',
    example: 7,
  })
  total: number;

  @ApiProperty({
    description: 'The page of ledger lines, oldest first with running balance.',
    type: [LedgerEntryDto],
  })
  items: LedgerEntryDto[];
}

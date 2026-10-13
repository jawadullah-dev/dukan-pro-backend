import { ApiProperty } from '@nestjs/swagger';
import { LedgerEntryDto } from '../../common-dto/response/ledger-entry.dto.js';

/** WF11 supplier side — same shape as the customer ledger. */
export class SupplierLedgerDto {
  @ApiProperty({ example: '01924f0a-0000-7000-8000-0000000000a1' })
  supplierId: string;

  @ApiProperty({ example: 'ABC Mobiles' })
  supplierName: string;

  @ApiProperty({
    description: 'Day-0 dues typed in at onboarding.',
    example: 0,
  })
  openingBalance: number;

  @ApiProperty({
    description:
      'Current payable: openingBalance + Σ ACTIVE real purchases − Σ ACTIVE supplier payments. Opening-stock purchases create no payable and are not listed. Matches GET /supplier-payments/payable/{id}.',
    example: 41000000,
  })
  balance: number;

  @ApiProperty({ description: 'Current page number (1-based)', example: 1 })
  page: number;

  @ApiProperty({ description: 'Rows requested per page', example: 50 })
  pageSize: number;

  @ApiProperty({ description: 'Timeline lines across all pages.', example: 7 })
  total: number;

  @ApiProperty({ type: [LedgerEntryDto] })
  items: LedgerEntryDto[];
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

export class SupplierReportRowDTO {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() phone: string | null;
  @ApiProperty() openingBalance: number;
  @ApiProperty({
    description: 'Σ ACTIVE real (non-opening-stock) purchases (paisa).',
  })
  bought: number;
  @ApiProperty({ description: 'Σ ACTIVE supplier payments (paisa).' })
  paid: number;
  @ApiProperty({
    description:
      'opening + bought − paid (paisa). What the shop owes this supplier.',
  })
  payable: number;
  @ApiPropertyOptional({
    description: 'Business day of the latest ACTIVE purchase.',
  })
  lastPurchaseDate: string | null;
}

export class SupplierReportSummaryDTO {
  @ApiProperty() count: number;
  @ApiProperty() totalPayable: number;
}

export const supplierReportCsvColumns: CsvColumn<SupplierReportRowDTO>[] = [
  { header: 'Supplier', value: (r) => r.name },
  { header: 'Phone', value: (r) => r.phone ?? '—' },
  { header: 'Opening', value: (r) => formatRupees(r.openingBalance) },
  { header: 'Bought', value: (r) => formatRupees(r.bought) },
  { header: 'Paid', value: (r) => formatRupees(r.paid) },
  { header: 'Payable', value: (r) => formatRupees(r.payable) },
  { header: 'Last Purchase', value: (r) => r.lastPurchaseDate ?? '—' },
];

export const supplierReportSummaryCsv = (s: SupplierReportSummaryDTO): string =>
  [
    `Suppliers,${s.count}`,
    `Total Payable,${formatRupees(s.totalPayable)}`,
  ].join('\r\n');

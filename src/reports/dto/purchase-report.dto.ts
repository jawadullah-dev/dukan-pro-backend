import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

export class PurchaseReportRowDTO {
  @ApiProperty() id: string;
  @ApiProperty() purchaseNo: string;
  @ApiProperty({ description: 'Business day as YYYY-MM-DD.' })
  purchaseDate: string;
  @ApiProperty() supplierName: string;
  @ApiPropertyOptional() supplierInvoiceRef: string | null;
  @ApiProperty({ description: 'Opening-stock bills create no payable.' })
  isOpeningStock: boolean;
  @ApiProperty() totalAmount: number;
  @ApiProperty({
    description: 'Σ ACTIVE supplier payments against this bill (paisa).',
  })
  paid: number;
  @ApiProperty({
    description: 'totalAmount − paid; 0 for opening stock (paisa).',
  })
  outstanding: number;
}

export class PurchaseReportSummaryDTO {
  @ApiProperty() count: number;
  @ApiProperty() countReal: number;
  @ApiProperty() countOpeningStock: number;
  @ApiProperty() sumTotalAmount: number;
  @ApiProperty() sumPaid: number;
  @ApiProperty() sumOutstanding: number;
}

export const purchaseReportCsvColumns: CsvColumn<PurchaseReportRowDTO>[] = [
  { header: 'Purchase No', value: (r) => r.purchaseNo },
  { header: 'Date', value: (r) => r.purchaseDate },
  { header: 'Supplier', value: (r) => r.supplierName },
  { header: 'Invoice Ref', value: (r) => r.supplierInvoiceRef ?? '—' },
  { header: 'Opening Stock', value: (r) => (r.isOpeningStock ? 'Yes' : 'No') },
  { header: 'Total', value: (r) => formatRupees(r.totalAmount) },
  { header: 'Paid', value: (r) => formatRupees(r.paid) },
  { header: 'Outstanding', value: (r) => formatRupees(r.outstanding) },
];

export const purchaseReportSummaryCsv = (s: PurchaseReportSummaryDTO): string =>
  [
    `Purchases,${s.count}`,
    `Opening Stock,${s.countOpeningStock}`,
    `Total Bought,${formatRupees(s.sumTotalAmount)}`,
    `Paid,${formatRupees(s.sumPaid)}`,
    `Outstanding,${formatRupees(s.sumOutstanding)}`,
  ].join('\r\n');

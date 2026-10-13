import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

export class CustomerReportRowDTO {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() phone: string | null;
  @ApiProperty() openingBalance: number;
  @ApiProperty({ description: 'Σ ACTIVE sales (paisa).' })
  bought: number;
  @ApiProperty({ description: 'Σ ACTIVE payments (paisa).' })
  paid: number;
  @ApiProperty({ description: 'Σ returnAmount of ACTIVE returns (paisa).' })
  returns: number;
  @ApiProperty({ description: 'Σ refund amounts on ACTIVE returns (paisa).' })
  refunds: number;
  @ApiProperty({
    description:
      'opening + bought − paid − returns + refunds (paisa). What the customer owes right now.',
  })
  outstanding: number;
  @ApiProperty({
    description:
      'Σ over ACTIVE sales with a past dueDate of their unpaid part (paisa).',
  })
  overdue: number;
  @ApiPropertyOptional({
    description: 'Business day of the latest ACTIVE sale.',
  })
  lastSaleDate: string | null;
}

export class CustomerReportSummaryDTO {
  @ApiProperty() count: number;
  @ApiProperty() totalOutstanding: number;
  @ApiProperty() totalOverdue: number;
}

export const customerReportCsvColumns: CsvColumn<CustomerReportRowDTO>[] = [
  { header: 'Customer', value: (r) => r.name },
  { header: 'Phone', value: (r) => r.phone ?? '—' },
  { header: 'Opening', value: (r) => formatRupees(r.openingBalance) },
  { header: 'Bought', value: (r) => formatRupees(r.bought) },
  { header: 'Paid', value: (r) => formatRupees(r.paid) },
  { header: 'Returns', value: (r) => formatRupees(r.returns) },
  { header: 'Refunds', value: (r) => formatRupees(r.refunds) },
  { header: 'Outstanding', value: (r) => formatRupees(r.outstanding) },
  { header: 'Overdue', value: (r) => formatRupees(r.overdue) },
  { header: 'Last Sale', value: (r) => r.lastSaleDate ?? '—' },
];

export const customerReportSummaryCsv = (s: CustomerReportSummaryDTO): string =>
  [
    `Customers,${s.count}`,
    `Total Outstanding,${formatRupees(s.totalOutstanding)}`,
    `Total Overdue,${formatRupees(s.totalOverdue)}`,
  ].join('\r\n');

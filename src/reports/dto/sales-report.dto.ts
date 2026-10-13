import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

/** One ACTIVE sale inside the period, with its money moved. Paisa numbers. */
export class SaleReportRowDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  saleNo: string;

  @ApiProperty({ description: 'Asia/Karachi business day as YYYY-MM-DD.' })
  saleDate: string;

  @ApiPropertyOptional({ description: 'null = walk-in cash sale.' })
  customerName: string | null;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  discount: number;

  @ApiProperty()
  totalAmount: number;

  /** ACTIVE payments against this sale (paisa). */
  @ApiProperty()
  paid: number;

  /** Σ returnAmount of ACTIVE returns on this sale (paisa). */
  @ApiProperty()
  returns: number;

  /** Σ refund amounts on ACTIVE returns of this sale (paisa). */
  @ApiProperty()
  refunds: number;

  /** totalAmount − returns + refunds − paid (paisa). */
  @ApiProperty()
  outstanding: number;

  /** subtotal − Σ(unitCost × qty) over the sale's lines (paisa). */
  @ApiProperty()
  profit: number;
}

export class SalesReportSummaryDTO {
  @ApiProperty() count: number;
  @ApiProperty() sumSubtotal: number;
  @ApiProperty() sumDiscount: number;
  @ApiProperty() sumTotalAmount: number;
  @ApiProperty() sumProfit: number;
  @ApiProperty() sumReturns: number;
  @ApiProperty() sumPaid: number;
}

export const salesReportCsvColumns: CsvColumn<SaleReportRowDTO>[] = [
  { header: 'Sale No', value: (r) => r.saleNo },
  { header: 'Date', value: (r) => r.saleDate },
  { header: 'Customer', value: (r) => r.customerName ?? 'Walk-in' },
  { header: 'Subtotal', value: (r) => formatRupees(r.subtotal) },
  { header: 'Discount', value: (r) => formatRupees(r.discount) },
  { header: 'Total', value: (r) => formatRupees(r.totalAmount) },
  { header: 'Paid', value: (r) => formatRupees(r.paid) },
  { header: 'Returns', value: (r) => formatRupees(r.returns) },
  { header: 'Refunds', value: (r) => formatRupees(r.refunds) },
  { header: 'Outstanding', value: (r) => formatRupees(r.outstanding) },
  { header: 'Profit', value: (r) => formatRupees(r.profit) },
];

export const salesReportSummaryCsv = (s: SalesReportSummaryDTO): string =>
  [
    `Sales,${s.count}`,
    `Subtotal,${formatRupees(s.sumSubtotal)}`,
    `Discount,${formatRupees(s.sumDiscount)}`,
    `Total Sales,${formatRupees(s.sumTotalAmount)}`,
    `Profit,${formatRupees(s.sumProfit)}`,
    `Returns,${formatRupees(s.sumReturns)}`,
    `Paid,${formatRupees(s.sumPaid)}`,
  ].join('\r\n');

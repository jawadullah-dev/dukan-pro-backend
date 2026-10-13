import { ApiProperty } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

export class ProfitReportSummaryDTO {
  @ApiProperty({ description: 'Total value of goods handed out (paisa).' })
  grossSales: number;
  @ApiProperty({
    description: 'Σ unitCost × qty over the period’s ACTIVE sales (paisa).',
  })
  cogs: number;
  @ApiProperty({ description: 'grossSales − cogs (paisa).' })
  grossProfit: number;
  @ApiProperty({
    description: 'Σ returnAmount of ACTIVE returns in the period (paisa).',
  })
  returns: number;
  @ApiProperty({
    description: 'Σ amount of ACTIVE expenses in the period (paisa).',
  })
  expenses: number;
  @ApiProperty({
    description:
      'grossSales − cogs − returns − expenses (paisa). May be negative.',
  })
  netProfit: number;
  @ApiProperty({ description: 'Number of ACTIVE sales in the period.' })
  salesCount: number;
}

export class ProfitDayRowDTO {
  @ApiProperty({ description: 'Asia/Karachi business day as YYYY-MM-DD.' })
  date: string;
  @ApiProperty() grossSales: number;
  @ApiProperty() cogs: number;
  @ApiProperty() returns: number;
  @ApiProperty() expenses: number;
  @ApiProperty() profit: number;
}

export const profitDayCsvColumns: CsvColumn<ProfitDayRowDTO>[] = [
  { header: 'Date', value: (r) => r.date },
  { header: 'Sales', value: (r) => formatRupees(r.grossSales) },
  { header: 'Cost', value: (r) => formatRupees(r.cogs) },
  { header: 'Returns', value: (r) => formatRupees(r.returns) },
  { header: 'Expenses', value: (r) => formatRupees(r.expenses) },
  { header: 'Profit', value: (r) => formatRupees(r.profit) },
];

export const profitReportSummaryCsv = (s: ProfitReportSummaryDTO): string =>
  [
    `Sales,${formatRupees(s.grossSales)}`,
    `Cost of Goods,${formatRupees(s.cogs)}`,
    `Gross Profit,${formatRupees(s.grossProfit)}`,
    `Returns,${formatRupees(s.returns)}`,
    `Expenses,${formatRupees(s.expenses)}`,
    `Net Profit,${formatRupees(s.netProfit)}`,
  ].join('\r\n');

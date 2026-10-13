import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

export class ExpenseReportRowDTO {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Business day as YYYY-MM-DD.' })
  expenseDate: string;
  @ApiProperty() categoryName: string;
  @ApiPropertyOptional() description: string | null;
  @ApiProperty() amount: number;
}

export class ExpenseCategoryBreakdownDTO {
  @ApiProperty() categoryName: string;
  @ApiProperty() count: number;
  @ApiProperty() total: number;
}

export class ExpenseReportSummaryDTO {
  @ApiProperty() count: number;
  @ApiProperty() total: number;
  @ApiProperty({ isArray: true, type: ExpenseCategoryBreakdownDTO })
  byCategory: ExpenseCategoryBreakdownDTO[];
}

export const expenseReportCsvColumns: CsvColumn<ExpenseReportRowDTO>[] = [
  { header: 'Date', value: (r) => r.expenseDate },
  { header: 'Category', value: (r) => r.categoryName },
  { header: 'Description', value: (r) => r.description ?? '—' },
  { header: 'Amount', value: (r) => formatRupees(r.amount) },
];

export const expenseReportSummaryCsv = (s: ExpenseReportSummaryDTO): string =>
  [
    `Total Expenses,${formatRupees(s.total)}`,
    `Count,${s.count}`,
    ...s.byCategory.map(
      (c) => `${c.categoryName},${formatRupees(c.total)},${c.count}`,
    ),
  ].join('\r\n');

export const expenseSummaryCsvHeader = 'Category,Total,Count';

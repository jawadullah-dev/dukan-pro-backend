import { ApiProperty } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

export class BestSellerReportRowDTO {
  @ApiProperty() productId: string;
  @ApiProperty() productName: string;
  @ApiProperty() categoryName: string;
  @ApiProperty() brandName: string;
  @ApiProperty() quantitySold: number;
  @ApiProperty({
    description: 'Σ line totals over the period’s ACTIVE sales (paisa).',
  })
  revenue: number;
}

export class BestSellerReportSummaryDTO {
  @ApiProperty() countProducts: number;
  @ApiProperty() totalQuantitySold: number;
  @ApiProperty() totalRevenue: number;
}

export const bestSellerReportCsvColumns: CsvColumn<BestSellerReportRowDTO>[] = [
  { header: 'Product', value: (r) => r.productName },
  { header: 'Category', value: (r) => r.categoryName },
  { header: 'Brand', value: (r) => r.brandName },
  { header: 'Quantity Sold', value: (r) => String(r.quantitySold) },
  { header: 'Revenue', value: (r) => formatRupees(r.revenue) },
];

export const bestSellerReportSummaryCsv = (
  s: BestSellerReportSummaryDTO,
): string =>
  [
    `Products,${s.countProducts}`,
    `Total Quantity,${s.totalQuantitySold}`,
    `Total Revenue,${formatRupees(s.totalRevenue)}`,
  ].join('\r\n');

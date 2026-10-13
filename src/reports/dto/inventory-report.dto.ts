import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CsvColumn, formatRupees } from '../../helpers/csv.helper.js';

export class InventoryReportRowDTO {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() sku: string | null;
  @ApiPropertyOptional() barcode: string | null;
  @ApiProperty() categoryName: string;
  @ApiProperty() brandName: string;
  @ApiProperty({ enum: ['QUANTITY', 'SERIALIZED'] })
  trackingType: string;
  @ApiProperty({
    description:
      'quantityOnHand for QUANTITY; count of IN_STOCK units for SERIALIZED.',
  })
  inStock: number;
  @ApiProperty({
    description:
      'qty × avgUnitCost for QUANTITY; Σ unitCost of IN_STOCK units for SERIALIZED (paisa).',
  })
  stockValue: number;
  @ApiProperty() lowStock: boolean;
  @ApiPropertyOptional({
    isArray: true,
    description: 'IN_STOCK IMEIs (SERIALIZED only).',
  })
  imeis: string[];
}

export class InventoryReportSummaryDTO {
  @ApiProperty() countProducts: number;
  @ApiProperty() countLowStock: number;
  @ApiProperty() countUnitsInStock: number;
  @ApiProperty() stockValueTotal: number;
}

export const inventoryReportCsvColumns: CsvColumn<InventoryReportRowDTO>[] = [
  { header: 'Product', value: (r) => r.name },
  { header: 'SKU', value: (r) => r.sku ?? '—' },
  { header: 'Barcode', value: (r) => r.barcode ?? '—' },
  { header: 'Category', value: (r) => r.categoryName },
  { header: 'Brand', value: (r) => r.brandName },
  { header: 'Tracking', value: (r) => r.trackingType },
  { header: 'In Stock', value: (r) => String(r.inStock) },
  { header: 'Stock Value', value: (r) => formatRupees(r.stockValue) },
  { header: 'Status', value: (r) => (r.lowStock ? 'Low' : 'OK') },
  { header: 'IMEIs', value: (r) => r.imeis.join(' | ') },
];

export const inventoryReportSummaryCsv = (
  s: InventoryReportSummaryDTO,
): string =>
  [
    `Products,${s.countProducts}`,
    `Low Stock,${s.countLowStock}`,
    `Units In Stock,${s.countUnitsInStock}`,
    `Stock Value,${formatRupees(s.stockValueTotal)}`,
  ].join('\r\n');

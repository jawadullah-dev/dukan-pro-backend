import { ApiProperty } from '@nestjs/swagger';

/**
 * Every list endpoint a dashboard number drills into.
 */
export class DashboardLinksDto {
  @ApiProperty({ example: '/sales?from=2026-10-07&to=2026-10-07' })
  todaySales: string;

  @ApiProperty({
    description: 'Same sales list — item rows carry unitCost for the profit.',
    example: '/sales?from=2026-10-07&to=2026-10-07',
  })
  todayNetProfit: string;

  @ApiProperty({ example: '/customers' })
  customerUdhar: string;

  @ApiProperty({ example: '/suppliers' })
  supplierPayable: string;

  @ApiProperty({ example: '/expenses?from=2026-10-07&to=2026-10-07' })
  todayExpenses: string;

  @ApiProperty({ example: '/products' })
  lowStockProducts: string;

  @ApiProperty({
    description: 'The shop’s cash ledger — every movement, newest first.',
    example: '/cash/movements',
  })
  cashPosition: string;
}

/**
 * WF14 — seven numbers, all derived from this shop's records with cancelled
 * rows excluded. Revenue, cash, Udhar, payable and expenses are deliberately
 * separate numbers: never add them together into one "total".
 */
export class DashboardDto {
  @ApiProperty({ example: 'today' })
  period: string;

  @ApiProperty({
    description: 'The business day (Asia/Karachi) these numbers answer for.',
    example: '2026-10-07',
  })
  date: string;

  @ApiProperty({
    description: 'Σ ACTIVE sale totals for the day, in PAISA.',
    example: 12000000,
  })
  todaySales: number;

  @ApiProperty({
    description:
      '(todaySales − Σ unitCost × quantity on those sales) − ACTIVE expenses for the day, in PAISA. Can be negative.',
    example: 1400000,
  })
  todayNetProfit: number;

  @ApiProperty({
    description:
      'Σ customer opening balances + Σ ACTIVE sales − Σ ACTIVE payments, shop-wide, in PAISA.',
    example: 30000000,
  })
  customerUdhar: number;

  @ApiProperty({
    description:
      'Σ supplier opening balances + Σ ACTIVE real purchases (opening stock excluded) − Σ ACTIVE supplier payments, in PAISA.',
    example: 45000000,
  })
  supplierPayable: number;

  @ApiProperty({
    description: 'Σ ACTIVE expenses dated today, in PAISA.',
    example: 500000,
  })
  todayExpenses: number;

  @ApiProperty({
    description:
      'Active products at or below their lowStockThreshold: accessories by quantityOnHand, phones by IN_STOCK unit count.',
    example: 4,
  })
  lowStockProducts: number;

  @ApiProperty({
    description: 'Σ cash_movements IN − Σ OUT for the shop, in PAISA.',
    example: 47850000,
  })
  cashPosition: number;

  @ApiProperty({ type: DashboardLinksDto })
  links: DashboardLinksDto;
}

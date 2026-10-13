import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiSuccessResponseDecorator } from '../../common-dto/decorator/ApiSuccessResponseDecorator.js';
import {
  BAD_REQUEST_RESPONSE,
  INTERNAL_SERVER_ERROR_RESPONSE,
  OK_RESPONSE_STATUS,
  UNAUTHORIZED_REQUEST_RESPONSE,
} from '../../constants/error-response.constant.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { ApiSuccessResponseDTO } from '../../common-dto/response/api-success-response.dto.js';
import { logError } from '../../helpers/logger-helper.js';
import { toCsv, CsvColumn } from '../../helpers/csv.helper.js';
import { pdfExportNotAvailable } from '../../errors/error.builder.js';
import { ReportsService } from '../services/reports.service.js';
import { ReportQueryFilterDto } from '../dto/report-query.filter.js';
import { ReportPageResponseDTO } from '../dto/report-page-response.dto.js';
import {
  SaleReportRowDTO,
  SalesReportSummaryDTO,
  salesReportCsvColumns,
  salesReportSummaryCsv,
} from '../dto/sales-report.dto.js';
import {
  PurchaseReportRowDTO,
  PurchaseReportSummaryDTO,
  purchaseReportCsvColumns,
  purchaseReportSummaryCsv,
} from '../dto/purchase-report.dto.js';
import {
  ExpenseReportRowDTO,
  ExpenseReportSummaryDTO,
  expenseReportCsvColumns,
  expenseReportSummaryCsv,
} from '../dto/expense-report.dto.js';
import {
  ProfitReportSummaryDTO,
  ProfitDayRowDTO,
  profitDayCsvColumns,
  profitReportSummaryCsv,
} from '../dto/profit-report.dto.js';
import {
  CustomerReportRowDTO,
  CustomerReportSummaryDTO,
  customerReportCsvColumns,
  customerReportSummaryCsv,
} from '../dto/customer-report.dto.js';
import {
  SupplierReportRowDTO,
  SupplierReportSummaryDTO,
  supplierReportCsvColumns,
  supplierReportSummaryCsv,
} from '../dto/supplier-report.dto.js';
import {
  InventoryReportRowDTO,
  InventoryReportSummaryDTO,
  inventoryReportCsvColumns,
  inventoryReportSummaryCsv,
} from '../dto/inventory-report.dto.js';
import {
  BestSellerReportRowDTO,
  BestSellerReportSummaryDTO,
  bestSellerReportCsvColumns,
  bestSellerReportSummaryCsv,
} from '../dto/best-seller-report.dto.js';

@ApiTags('reports')
@Controller('reports')
@ApiBearerAuth()
@ApiExtraModels(
  SaleReportRowDTO,
  SalesReportSummaryDTO,
  PurchaseReportRowDTO,
  PurchaseReportSummaryDTO,
  ExpenseReportRowDTO,
  ExpenseReportSummaryDTO,
  ProfitDayRowDTO,
  ProfitReportSummaryDTO,
  CustomerReportRowDTO,
  CustomerReportSummaryDTO,
  SupplierReportRowDTO,
  SupplierReportSummaryDTO,
  InventoryReportRowDTO,
  InventoryReportSummaryDTO,
  BestSellerReportRowDTO,
  BestSellerReportSummaryDTO,
)
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @ApiOperation({
    summary: 'Sales report',
    description:
      'WF18 — per-sale totals, discount and profit over today / this week / this month / a custom range ' +
      '(Asia/Karachi business days). CANCELLED sales are excluded. `format=csv` downloads the same rows as ' +
      'a CSV instead of JSON. profit = subtotal − Σ(unitCost × qty) on that sale.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Sales report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async salesReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<SaleReportRowDTO, SalesReportSummaryDTO>
      >
    | string
  > {
    try {
      const report = await this.reportsService.getSalesReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'sales',
        salesReportCsvColumns,
        salesReportSummaryCsv,
        'Sales report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'salesReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to build sales report');
    }
  }

  @Get('purchases')
  @ApiOperation({
    summary: 'Purchase report',
    description:
      'WF18 — what was bought in the period, how much has been paid and what is still due per bill. ' +
      'Opening-stock bills are shown but create no payable. CANCELLED purchases are excluded.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Purchase report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async purchaseReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<PurchaseReportRowDTO, PurchaseReportSummaryDTO>
      >
    | string
  > {
    try {
      const report = await this.reportsService.getPurchaseReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'purchases',
        purchaseReportCsvColumns,
        purchaseReportSummaryCsv,
        'Purchase report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'purchaseReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to build purchase report');
    }
  }

  @Get('expenses')
  @ApiOperation({
    summary: 'Expense report',
    description:
      'WF18 — every ACTIVE expense in the period with totals by category (rent, electricity, salary…). ' +
      'Buying stock is a purchase, never an expense. `format=csv` includes a category-breakdown block.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Expense report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async expenseReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<ExpenseReportRowDTO, ExpenseReportSummaryDTO>
      >
    | string
  > {
    try {
      const report = await this.reportsService.getExpenseReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'expenses',
        expenseReportCsvColumns,
        expenseReportSummaryCsv,
        'Expense report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'expenseReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to build expense report');
    }
  }

  @Get('profit')
  @ApiOperation({
    summary: 'Profit report',
    description:
      'WF18 — gross and net profit for the period. net = sales − Σ(unitCost × qty) − returns (goods given ' +
      'back in the period) − expenses. Refunds are the cash side of a return and are NOT subtracted again — ' +
      'revenue and cash are never mixed (WF18 rule). Returns daily rows for the chart.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Profit report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async profitReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<ProfitDayRowDTO, ProfitReportSummaryDTO>
      >
    | string
  > {
    try {
      const report = await this.reportsService.getProfitReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'profit',
        profitDayCsvColumns,
        profitReportSummaryCsv,
        'Profit report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'profitReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to build profit report');
    }
  }

  @Get('customers')
  @ApiOperation({
    summary: 'Customer report (who owes how much)',
    description:
      'WF18 — a snapshot of every customer’s Udhar right now: bought, paid, returns, refunds, outstanding ' +
      '(opening + bought − paid − returns + refunds) and overdue (past dueDate parts of ACTIVE sales). ' +
      'The date range is ignored — outstanding is a cumulative fact, not a period sum.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Customer report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async customerReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<CustomerReportRowDTO, CustomerReportSummaryDTO>
      >
    | string
  > {
    try {
      const report = await this.reportsService.getCustomerReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'customers',
        customerReportCsvColumns,
        customerReportSummaryCsv,
        'Customer report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'customerReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to build customer report');
    }
  }

  @Get('suppliers')
  @ApiOperation({
    summary: 'Supplier report (payable per supplier)',
    description:
      'WF18 — a snapshot of how much the shop owes each supplier: opening balance + bought (real, ' +
      'non-opening-stock purchases) − paid. The date range is ignored — payable is a cumulative fact.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Supplier report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async supplierReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<SupplierReportRowDTO, SupplierReportSummaryDTO>
      >
    | string
  > {
    try {
      const report = await this.reportsService.getSupplierReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'suppliers',
        supplierReportCsvColumns,
        supplierReportSummaryCsv,
        'Supplier report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'supplierReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to build supplier report');
    }
  }

  @Get('inventory')
  @ApiOperation({
    summary: 'Inventory report (stock now)',
    description:
      'WF18 — a snapshot of every ACTIVE product: quantity on hand (accessories) or IN_STOCK units ' +
      '(phones, with their IMEIs), stock value and low-stock flag. The date range is ignored — stock is a point-in-time fact.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Inventory report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async inventoryReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<InventoryReportRowDTO, InventoryReportSummaryDTO>
      >
    | string
  > {
    try {
      const report = await this.reportsService.getInventoryReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'inventory',
        inventoryReportCsvColumns,
        inventoryReportSummaryCsv,
        'Inventory report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'inventoryReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to build inventory report',
      );
    }
  }

  @Get('best-sellers')
  @ApiOperation({
    summary: 'Best-selling products report',
    description:
      'WF18 — Σ quantity per product over the period’s ACTIVE sales, most sold first: what customers ' +
      'actually buy. Revenue = Σ line totals. Adds the same discount-free line totals the sales report uses.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReportPageResponseDTO,
      'Best-sellers report fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async bestSellersReport(
    @Query() query: ReportQueryFilterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    | ApiSuccessResponseDTO<
        ReportPageResponseDTO<
          BestSellerReportRowDTO,
          BestSellerReportSummaryDTO
        >
      >
    | string
  > {
    try {
      const report = await this.reportsService.getBestSellersReport(
        query,
        req.user.shopId,
      );
      return this.exportOrJson(
        res,
        query,
        report,
        'best-sellers',
        bestSellerReportCsvColumns,
        bestSellerReportSummaryCsv,
        'Best-sellers report fetched successfully',
      );
    } catch (error) {
      logError('reports.controller.ts', 'bestSellersReport', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to build best-sellers report',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // CSV plumbing (shared by every report)
  // ---------------------------------------------------------------------------

  private exportOrJson<T, S>(
    res: Response,
    query: ReportQueryFilterDto,
    report: ReportPageResponseDTO<T, S>,
    name: string,
    columns: CsvColumn<T>[],
    summaryCsv: (summary: S) => string,
    jsonMessage: string,
  ): ApiSuccessResponseDTO<ReportPageResponseDTO<T, S>> | string {
    if (!query.format) {
      return new ApiSuccessResponseDTO(jsonMessage, report);
    }
    if (query.format === 'pdf') {
      throw new BadRequestException(pdfExportNotAvailable());
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.filename(name, report)}"`,
    );
    return `${summaryCsv(report.summary)}\r\n\r\n${toCsv(report.items, columns)}`;
  }

  private filename<T, S>(
    name: string,
    report: ReportPageResponseDTO<T, S>,
  ): string {
    return `${name}-${report.from}-to-${report.to}.csv`;
  }
}

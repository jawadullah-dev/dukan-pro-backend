import {
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiSuccessResponseDecorator } from '../../common-dto/decorator/ApiSuccessResponseDecorator.js';
import {
  BAD_REQUEST_RESPONSE,
  INTERNAL_SERVER_ERROR_RESPONSE,
  NOT_FOUND_REQUEST_RESPONSE,
  OK_RESPONSE_STATUS,
  UNAUTHORIZED_REQUEST_RESPONSE,
} from '../../constants/error-response.constant.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { ApiSuccessResponseDTO } from '../../common-dto/response/api-success-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import { CancelImpactResponseDto } from '../../common-dto/response/cancel-impact.dto.js';
import { SalesService, CancelSaleResult } from '../services/sales.service.js';
import { CreateSaleDto } from '../dto/create-sale.dto.js';
import { CancelSaleDto } from '../dto/cancel-sale.dto.js';
import { SaleQueryFilterDto } from '../dto/sale-query.filter.js';
import { ResponseSaleDto } from '../dto/response-sale.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('sales')
@Controller('sales')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Create a sale (cash / part payment / Udhar)',
    description:
      'WF9 — sells items, reduces stock and records whatever was paid, all in ONE transaction. ' +
      'subtotal and totalAmount are computed server-side from quantity × unitPrice; never send them. ' +
      'Phone lines send inventoryUnitId (the exact IMEI unit) and quantity must be 1; quantity lines must not send inventoryUnitId. ' +
      'A phone line, or any unpaid balance, requires customerId. ' +
      'clientRequestId makes the save double-tap safe: a repeat returns success without writing again. ' +
      'All amounts are in PAISA.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Sale created successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createSale(
    @Body() createSaleDto: CreateSaleDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.salesService.createSale(
        createSaleDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('sales.controller.ts', 'createSale', error, {
        shopId: req.user?.shopId,
        clientRequestId: createSaleDto?.clientRequestId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to create sale');
    }
  }

  @Post('/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a sale with a reason',
    description:
      'WF12 — fixes a wrong sale without editing or deleting anything. Restores stock (phones SOLD → IN_STOCK, accessories +qty) with SALE_CANCEL movements, ' +
      'cancels every ACTIVE payment of the sale and adds one cash REVERSAL (OUT) per payment, then marks the sale CANCELLED with the reason, time and user. ' +
      'cancelReason is required (1–1000 chars). An already-cancelled sale returns 400. ' +
      'If the refunds would take cash below zero the response is 200 { confirmOverdraft: true, shortfall, message }; ' +
      'resend the same body plus confirmOverdraft: true to cancel anyway (the reversal rows are then flagged isOverdraft).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Sale cancelled successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async cancelSale(
    @Param('id') id: string,
    @Body() cancelSaleDto: CancelSaleDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<CancelSaleResult>> {
    try {
      const result = await this.salesService.cancelSale(
        id,
        cancelSaleDto,
        req.user.shopId,
        req.user.userId,
      );
      // The overdraft prompt writes nothing — must not claim 201.
      res.status('confirmOverdraft' in result ? 200 : 201);
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('sales.controller.ts', 'cancelSale', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to cancel sale');
    }
  }

  @Get('/:id/cancel-impact')
  @ApiOperation({
    summary: 'Preview what cancelling this sale would change',
    description:
      'WF12 step 3 — shows the impact BEFORE anything is saved: stock that comes back (phones SOLD → IN_STOCK, accessories +qty), ' +
      'the cash that would be reversed (one OUT per ACTIVE payment) with the resulting drawer balance, and the customer Udhar after the cancel. ' +
      'blocked=true means the confirm would be refused (a phone is no longer SOLD), with the reason in the same words the 400 would use. ' +
      'Read-only — writes nothing. 400 if the sale is already cancelled, 404 cross-shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      CancelImpactResponseDto,
      'Cancel impact fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getCancelImpact(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<CancelImpactResponseDto>> {
    try {
      const res = await this.salesService.getCancelImpact(id, req.user.shopId);
      return new ApiSuccessResponseDTO(
        'Cancel impact fetched successfully',
        res,
      );
    } catch (error) {
      logError('sales.controller.ts', 'getCancelImpact', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch cancel impact');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List sales',
    description:
      'Paginated list scoped to the shop in the JWT. Filter by customer, status and a saleDate range; search matches the sale number and the customer name.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Sales fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getSales(
    @Query() query: SaleQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseSaleDto>>> {
    try {
      const res = await this.salesService.getSales(query, req.user.shopId);
      return new ApiSuccessResponseDTO('Sales fetched successfully', res);
    } catch (error) {
      logError('sales.controller.ts', 'getSales', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch sales');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one sale by id',
    description:
      'Returns the sale header, every line with product name and IMEI, and the payments recorded against it — the data a receipt needs. 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseSaleDto, 'Sale fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getSaleById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseSaleDto>> {
    try {
      const res = await this.salesService.getSaleById(id, req.user.shopId);
      return new ApiSuccessResponseDTO('Sale fetched successfully', res);
    } catch (error) {
      logError('sales.controller.ts', 'getSaleById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch sale');
    }
  }
}

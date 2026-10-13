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
import {
  SupplierPaymentsService,
  CreateSupplierPaymentResult,
} from '../services/supplier-payments.service.js';
import { CreateSupplierPaymentDto } from '../dto/create-supplier-payment.dto.js';
import { CancelSupplierPaymentDto } from '../dto/cancel-supplier-payment.dto.js';
import { SupplierPaymentQueryFilterDto } from '../dto/supplier-payment-query.filter.js';
import {
  ResponseSupplierPaymentDto,
  SupplierPayableDto,
} from '../dto/response-supplier-payment.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('supplier-payments')
@Controller('supplier-payments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class SupplierPaymentsController {
  constructor(
    private readonly supplierPaymentsService: SupplierPaymentsService,
  ) {}

  @Post('/')
  @ApiOperation({
    summary: 'Pay a supplier (all or part of what is owed)',
    description:
      'WF7 — money leaves the drawer in ONE transaction: supplier_payments + cash_movements (SUPPLIER_PAYMENT, OUT). ' +
      'Outstanding is derived from active rows only: opening balance + active real purchases − active payments. ' +
      'purchaseId targets one bill; omit it to pay down the opening balance. ' +
      'amount must be more than 0 and not more than what is left. ' +
      'If the payment would take cash below zero the response is 200 ' +
      '{ confirmOverdraft: true, shortfall, message }; resend the same body plus confirmOverdraft: true to save ' +
      '(the cash row is then flagged isOverdraft).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Supplier payment recorded successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createSupplierPayment(
    @Body() createSupplierPaymentDto: CreateSupplierPaymentDto,
    @Req() req: any,
    // passthrough: we still return the body ourselves, but the status code has
    // to differ — 201 only when a row was actually written.
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<CreateSupplierPaymentResult>> {
    try {
      const result = await this.supplierPaymentsService.createSupplierPayment(
        createSupplierPaymentDto,
        req.user.shopId,
        req.user.userId,
      );
      // The overdraft prompt creates nothing, so it must not claim 201.
      res.status('confirmOverdraft' in result ? 200 : 201);
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError(
        'supplier-payments.controller.ts',
        'createSupplierPayment',
        error,
        {
          shopId: req.user?.shopId,
          supplierId: createSupplierPaymentDto?.supplierId,
          purchaseId: createSupplierPaymentDto?.purchaseId,
        },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to record supplier payment',
      );
    }
  }

  @Post('/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a supplier payment with a reason',
    description:
      'WF12 — fixes a wrong supplier payment without editing or deleting it. Marks the payment CANCELLED with the reason, time and user ' +
      'and adds one cash REVERSAL (IN) pointing back at the original movement; the payable comes back automatically. ' +
      'cancelReason is required (1–1000 chars). An already-cancelled payment returns 400. ' +
      'Reversals only add cash, so there is no overdraft prompt here.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Supplier payment cancelled successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async cancelSupplierPayment(
    @Param('id') id: string,
    @Body() cancelSupplierPaymentDto: CancelSupplierPaymentDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.supplierPaymentsService.cancelSupplierPayment(
        id,
        cancelSupplierPaymentDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError(
        'supplier-payments.controller.ts',
        'cancelSupplierPayment',
        error,
        {
          shopId: req.user?.shopId,
          id,
        },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to cancel supplier payment',
      );
    }
  }

  @Get('/:id/cancel-impact')
  @ApiOperation({
    summary: 'Preview what cancelling this supplier payment would change',
    description:
      'WF12 step 3 — shows the impact BEFORE anything is saved: the cash that would come back into the drawer (one IN reversal) ' +
      'with the resulting balance, and the supplier payable after the cancel. Never blocked. ' +
      'Read-only — writes nothing. 400 if the payment is already cancelled, 404 cross-shop.',
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
      const res = await this.supplierPaymentsService.getCancelImpact(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Cancel impact fetched successfully',
        res,
      );
    } catch (error) {
      logError('supplier-payments.controller.ts', 'getCancelImpact', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch cancel impact');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List supplier payments',
    description:
      'Paginated list scoped to the shop in the JWT. Filter by supplier, purchase, status and a paymentDate range; search matches the supplier name and the purchase number.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PaginatedResponseDTO,
      'Supplier payments fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getSupplierPayments(
    @Query() query: SupplierPaymentQueryFilterDto,
    @Req() req: any,
  ): Promise<
    ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseSupplierPaymentDto>>
  > {
    try {
      const res = await this.supplierPaymentsService.getSupplierPayments(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Supplier payments fetched successfully',
        res,
      );
    } catch (error) {
      logError(
        'supplier-payments.controller.ts',
        'getSupplierPayments',
        error,
        { shopId: req.user?.shopId, query },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch supplier payments',
      );
    }
  }

  @Get('/payable/:supplierId')
  @ApiOperation({
    summary: 'What is owed to a supplier, and which bills are unpaid',
    description:
      'WF7 steps 1–2 — the screen the owner sees before typing an amount. Returns the derived payable (opening balance + active real purchases − active payments), how much of the opening balance is left, and every unpaid bill oldest-first with its remaining amount.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      SupplierPayableDto,
      'Supplier payable fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getSupplierPayable(
    @Param('supplierId') supplierId: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<SupplierPayableDto>> {
    try {
      const res = await this.supplierPaymentsService.getSupplierPayable(
        supplierId,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Supplier payable fetched successfully',
        res,
      );
    } catch (error) {
      logError('supplier-payments.controller.ts', 'getSupplierPayable', error, {
        shopId: req.user?.shopId,
        supplierId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch supplier payable',
      );
    }
  }
}

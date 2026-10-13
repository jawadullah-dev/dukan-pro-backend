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
  PaymentsService,
  CancelPaymentResult,
} from '../services/payments.service.js';
import { CreatePaymentDto } from '../dto/create-payment.dto.js';
import { CancelPaymentDto } from '../dto/cancel-payment.dto.js';
import { PaymentQueryFilterDto } from '../dto/payment-query.filter.js';
import { ResponsePaymentDto } from '../dto/response-payment.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('payments')
@Controller('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Record a customer payment against Udhar',
    description:
      'WF10 — money received later from a customer who owes the shop. The amount must be more than 0 and not more than their outstanding (opening balance + unpaid sales). ' +
      'By default the money is applied oldest-first: opening balance, then sales by date; send salesIds to choose specific sales instead (the opening balance is then never touched). ' +
      'One request writes one payments row per sale covered (same receiptGroupId) plus one cash row each. ' +
      'clientRequestId makes the save double-tap safe: a repeat returns success without writing again. ' +
      'All amounts are in PAISA.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Payment recorded successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createPayment(
    @Body() createPaymentDto: CreatePaymentDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.paymentsService.createPayment(
        createPaymentDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('payments.controller.ts', 'createPayment', error, {
        shopId: req.user?.shopId,
        clientRequestId: createPaymentDto?.clientRequestId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to record payment');
    }
  }

  @Post('/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a customer payment with a reason',
    description:
      'WF12 — fixes a wrong customer payment without editing or deleting it. Marks the payment CANCELLED with the reason, time and user ' +
      'and adds one cash REVERSAL (OUT) pointing back at the original movement; the customer’s Udhar comes back automatically. ' +
      'cancelReason is required (1–1000 chars). An already-cancelled payment returns 400. ' +
      'If the refund would take cash below zero the response is 200 { confirmOverdraft: true, shortfall, message}; ' +
      'resend the same body plus confirmOverdraft: true to cancel anyway (the reversal row is then flagged isOverdraft).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Payment cancelled successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async cancelPayment(
    @Param('id') id: string,
    @Body() cancelPaymentDto: CancelPaymentDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<CancelPaymentResult>> {
    try {
      const result = await this.paymentsService.cancelPayment(
        id,
        cancelPaymentDto,
        req.user.shopId,
        req.user.userId,
      );
      // The overdraft prompt writes nothing — must not claim 201.
      res.status('confirmOverdraft' in result ? 200 : 201);
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('payments.controller.ts', 'cancelPayment', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to cancel payment');
    }
  }

  @Get('/:id/cancel-impact')
  @ApiOperation({
    summary: 'Preview what cancelling this customer payment would change',
    description:
      'WF12 step 3 — shows the impact BEFORE anything is saved: the cash that would leave the drawer (one OUT reversal) ' +
      'with the resulting balance, and the customer Udhar after the cancel. Never blocked. ' +
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
      const res = await this.paymentsService.getCancelImpact(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Cancel impact fetched successfully',
        res,
      );
    } catch (error) {
      logError('payments.controller.ts', 'getCancelImpact', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch cancel impact');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List customer payments',
    description:
      'Paginated list scoped to the shop in the JWT. Filter by customer, sale, receipt group, status and a paymentDate range; search matches the customer name and notes. Cancelled rows stay visible unless you filter by status.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Payments fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getPayments(
    @Query() query: PaymentQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponsePaymentDto>>> {
    try {
      const res = await this.paymentsService.getPayments(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Payments fetched successfully', res);
    } catch (error) {
      logError('payments.controller.ts', 'getPayments', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch payments');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one payment by id',
    description:
      'Returns the payment row with the customer name and sale number resolved in one join. 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponsePaymentDto, 'Payment fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getPaymentById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponsePaymentDto>> {
    try {
      const res = await this.paymentsService.getPaymentById(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Payment fetched successfully', res);
    } catch (error) {
      logError('payments.controller.ts', 'getPaymentById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch payment');
    }
  }
}

import {
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { type Response } from 'express';
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
import {
  CashService,
  OwnerWithdrawalResult,
} from '../services/cash.service.js';
import { CreateOpeningCashDto } from '../dto/create-opening-cash.dto.js';
import { CreateOwnerInvestmentDto } from '../dto/create-owner-investment.dto.js';
import { CreateOwnerWithdrawalDto } from '../dto/create-owner-withdrawal.dto.js';
import { CashMovementQueryFilterDto } from '../dto/cash-movement-query.filter.js';
import { ResponseCashMovementDto } from '../dto/response-cash-movement.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('cash')
@Controller('cash')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Post('/opening')
  @ApiOperation({
    summary: 'Record the opening cash balance',
    description:
      'WF1 — the Day-0 drawer balance the owner starts with. Inserts one cash_movements row ' +
      '(OPENING_CASH, IN) in a transaction. Can be set only once per shop; a second attempt is 400. ' +
      'Enter it before recording sales, expenses or payments so the cash position starts right.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Opening cash recorded successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createOpeningCash(
    @Body() createOpeningCashDto: CreateOpeningCashDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.cashService.createOpeningCash(
        createOpeningCashDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('cash.controller.ts', 'createOpeningCash', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to record opening cash');
    }
  }

  @Post('/investments')
  @ApiOperation({
    summary: 'Record money the owner put into the shop',
    description:
      'WF16 — the owner adding their own cash to the drawer. Inserts one cash_movements row ' +
      '(OWNER_INVESTMENT, IN). This is NOT revenue: the dashboard profit never counts it. ' +
      'Cash can only go up, so this always answers 201.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Owner investment recorded successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createOwnerInvestment(
    @Body() createOwnerInvestmentDto: CreateOwnerInvestmentDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.cashService.createOwnerInvestment(
        createOwnerInvestmentDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('cash.controller.ts', 'createOwnerInvestment', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to record owner investment',
      );
    }
  }

  @Post('/withdrawals')
  @ApiOperation({
    summary: 'Record money the owner took out of the shop',
    description:
      'WF16 — the owner removing their own cash from the drawer. Inserts one cash_movements row ' +
      '(OWNER_WITHDRAWAL, OUT). This is NOT an operating expense: the dashboard profit never counts it. ' +
      'If the withdrawal would take the drawer below zero the request answers 200 with the shortfall and ' +
      'writes nothing — retry with confirmOverdraft: true to save it anyway (isOverdraft: true).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Owner withdrawal recorded successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createOwnerWithdrawal(
    @Body() createOwnerWithdrawalDto: CreateOwnerWithdrawalDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<OwnerWithdrawalResult>> {
    try {
      const result = await this.cashService.createOwnerWithdrawal(
        createOwnerWithdrawalDto,
        req.user.shopId,
        req.user.userId,
      );
      // Overdraft prompt writes nothing — must not claim 201.
      res.status('confirmOverdraft' in result ? 200 : 201);
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('cash.controller.ts', 'createOwnerWithdrawal', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to record owner withdrawal',
      );
    }
  }

  @Get('/movements')
  @ApiOperation({
    summary: 'List cash movements',
    description:
      'The why behind the cash balance: every row of this shop’s append-only cash ledger, newest first. ' +
      'Filter by type, direction and a movementDate range; search matches the note. ' +
      'This is the drill-through behind the dashboard’s cashPosition number.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PaginatedResponseDTO,
      'Cash movements fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getCashMovements(
    @Query() query: CashMovementQueryFilterDto,
    @Req() req: any,
  ): Promise<
    ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseCashMovementDto>>
  > {
    try {
      const result = await this.cashService.getCashMovements(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Cash movements fetched successfully',
        result,
      );
    } catch (error) {
      logError('cash.controller.ts', 'getCashMovements', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch cash movements');
    }
  }
}

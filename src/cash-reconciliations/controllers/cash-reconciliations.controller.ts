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
  UseGuards,
} from '@nestjs/common';
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
import { CashReconciliationsService } from '../services/cash-reconciliations.service.js';
import { CreateCashReconciliationDto } from '../dto/create-cash-reconciliation.dto.js';
import { CashReconciliationQueryFilterDto } from '../dto/cash-reconciliation-query.filter.js';
import { ResponseCashReconciliationDto } from '../dto/response-cash-reconciliation.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('cash-reconciliations')
@Controller('cash-reconciliations')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class CashReconciliationsController {
  constructor(
    private readonly cashReconciliationsService: CashReconciliationsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Record a cash count and any adjustment to the ledger',
    description:
      'WF17 — the owner compares the system cash (SUM(IN) − SUM(OUT)) with what they actually counted, ' +
      'and records the difference. A matching count only saves the reconciliation row; a non-zero difference ' +
      'also writes one cash_movements RECONCILIATION_ADJUSTMENT row (IN when the drawer has more, OUT when it ' +
      'has less) so system cash lands exactly on the counted amount. A reason is required whenever the ' +
      'difference is not zero. Old cash rows are never edited.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Cash reconciliation recorded successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createReconciliation(
    @Body() createCashReconciliationDto: CreateCashReconciliationDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.cashReconciliationsService.createReconciliation(
        createCashReconciliationDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError(
        'cash-reconciliations.controller.ts',
        'createReconciliation',
        error,
        { shopId: req.user?.shopId },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to record cash reconciliation',
      );
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List cash reconciliations',
    description:
      'WF17 — every count this shop ever recorded, newest first, with the system/counted/difference ' +
      'numbers and reason. This is the audit trail for finding cash mistakes later. Filter by reason ' +
      'text, a reconciledAt range and sort.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PaginatedResponseDTO,
      'Cash reconciliations fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getReconciliations(
    @Query() query: CashReconciliationQueryFilterDto,
    @Req() req: any,
  ): Promise<
    ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseCashReconciliationDto>>
  > {
    try {
      const result = await this.cashReconciliationsService.getReconciliations(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Cash reconciliations fetched successfully',
        result,
      );
    } catch (error) {
      logError(
        'cash-reconciliations.controller.ts',
        'getReconciliations',
        error,
        { shopId: req.user?.shopId, query },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch cash reconciliations',
      );
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one cash reconciliation',
    description: 'WF17 — a single count by id, scoped to the requesting shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ResponseCashReconciliationDto,
      'Cash reconciliation fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getReconciliationById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseCashReconciliationDto>> {
    try {
      const result =
        await this.cashReconciliationsService.getReconciliationById(
          id,
          req.user.shopId,
        );
      return new ApiSuccessResponseDTO(
        'Cash reconciliation fetched successfully',
        result,
      );
    } catch (error) {
      logError(
        'cash-reconciliations.controller.ts',
        'getReconciliationById',
        error,
        { shopId: req.user?.shopId, id },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch cash reconciliation',
      );
    }
  }
}

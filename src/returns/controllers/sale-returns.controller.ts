import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  InternalServerErrorException,
  Param,
  Post,
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
import {
  ReturnsService,
  CreateReturnResult,
} from '../services/returns.service.js';
import { CreateReturnDto } from '../dto/create-return.dto.js';
import {
  ReturnPreviewDto,
  ReturnPreviewResponseDto,
} from '../dto/return-preview.dto.js';
import { logError } from '../../helpers/logger-helper.js';

/**
 * The two write-side routes live under /sales (they act on one sale), the
 * read-side routes live on ReturnsController under /returns — the two
 * controllers never share a path.
 */
@ApiTags('sales')
@Controller('sales')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class SaleReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Post('/:id/returns/preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Preview how a return would settle (dry run)',
    description:
      'WF15 step 4 — shows the return value, the outstanding Udhar before and after, the maximum refundable cash and the drawer balance, WITHOUT writing anything. ' +
      'Send the same items (+ refundAmount) you would POST to /sales/{id}/returns. A bad line returns the same 400/404 the save would.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ReturnPreviewResponseDto,
      'Return preview computed successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async previewReturn(
    @Param('id') id: string,
    @Body() previewDto: ReturnPreviewDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ReturnPreviewResponseDto>> {
    try {
      const res = await this.returnsService.previewReturn(
        id,
        previewDto,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Return preview computed successfully',
        res,
      );
    } catch (error) {
      logError('returns.controller.ts', 'previewReturn', error, {
        shopId: req.user?.shopId,
        saleId: id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to preview return');
    }
  }

  @Post('/:id/returns')
  @ApiOperation({
    summary: 'Return items against a sale (and optionally refund cash)',
    description:
      'WF15 — one transaction: validates sold-minus-returned (quantity lines) and one-IMEI-once (phone lines), computes the return value server-side ' +
      '(quantity × unitPrice minus this return’s share of the sale discount), restores stock for GOOD items (CUSTOMER_RETURN movement) and takes DAMAGED ' +
      'items back off the shelf (phones become DAMAGED, accessories get a write-off), then records the refund. ' +
      'The refund first cancels the sale’s outstanding Udhar — only the already-paid remainder can leave the drawer — and refundAmount can never exceed ' +
      'what was actually paid minus earlier refunds. refundAmount 0 (or omitting it) is allowed: the whole value stays as Udhar relief. ' +
      'If the refund would take cash below zero the response is 200 { confirmOverdraft: true, shortfall, message } with nothing written; ' +
      'resend the same body plus confirmOverdraft: true to save anyway. All amounts are in PAISA. ' +
      'The sale itself is never edited, and a sale with returns can no longer be cancelled.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Return recorded successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createReturn(
    @Param('id') id: string,
    @Body() createReturnDto: CreateReturnDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<CreateReturnResult>> {
    try {
      const result = await this.returnsService.createReturn(
        id,
        createReturnDto,
        req.user.shopId,
        req.user.userId,
      );
      // Overdraft prompt writes nothing — must not claim 201.
      res.status('confirmOverdraft' in result ? 200 : 201);
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('returns.controller.ts', 'createReturn', error, {
        shopId: req.user?.shopId,
        saleId: id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to record return');
    }
  }
}

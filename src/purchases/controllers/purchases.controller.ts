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
  PurchasesService,
  CreatePurchaseResult,
} from '../services/purchases.service.js';
import { CreatePurchaseDto } from '../dto/create-purchase.dto.js';
import { CancelPurchaseDto } from '../dto/cancel-purchase.dto.js';
import { PurchaseQueryFilterDto } from '../dto/purchase-query.filter.js';
import { ResponsePurchaseDto } from '../dto/response-purchase.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('purchases')
@Controller('purchases')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Record a purchase (stock in)',
    description:
      'WF6 — buys goods from a supplier, fills stock and optionally pays cash, all in ONE transaction. ' +
      'totalAmount is computed server-side from quantity × unitCost; never send it. ' +
      'SERIALIZED (phone) lines must supply exactly one IMEI per unit; QUANTITY lines must not send imeis. ' +
      'clientRequestId makes the save double-tap safe: a repeat returns success without writing again. ' +
      'isOpeningStock writes stock only — no payable, no cash. ' +
      'If paidNow would take cash below zero the response is 200 ' +
      '{ confirmOverdraft: true, shortfall, message }; resend the same body plus confirmOverdraft: true to save ' +
      '(the cash row is then flagged isOverdraft).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Purchase created successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createPurchase(
    @Body() createPurchaseDto: CreatePurchaseDto,
    @Req() req: any,
    // passthrough: we still return the body ourselves, but the status code has
    // to differ — 201 only when a row was actually written.
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<CreatePurchaseResult>> {
    try {
      const result = await this.purchasesService.createPurchase(
        createPurchaseDto,
        req.user.shopId,
        req.user.userId,
      );
      // The overdraft prompt creates nothing, so it must not claim 201.
      res.status('confirmOverdraft' in result ? 200 : 201);
      // Both shapes carry their own human sentence: "Purchase created
      // successfully" or the overdraft warning the client must show.
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('purchases.controller.ts', 'createPurchase', error, {
        shopId: req.user?.shopId,
        clientRequestId: createPurchaseDto?.clientRequestId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to create purchase');
    }
  }

  @Post('/:id/cancel')
  @ApiOperation({
    summary: 'Cancel a purchase with a reason',
    description:
      'WF12 — fixes a wrong purchase without editing or deleting anything. Phones become VOIDED, accessories come off the shelf, ' +
      'PURCHASE_CANCEL movements are appended, and the bill’s ACTIVE supplier_payments are cancelled with one cash REVERSAL (IN) each. ' +
      'cancelReason is required (1–1000 chars). An already-cancelled purchase returns 400. ' +
      'Hard blocks (400): any phone from it is not IN_STOCK (sold / damaged / lost), or accessory stock would go negative. ' +
      'Reversals only add cash, so there is no overdraft prompt here.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Purchase cancelled successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async cancelPurchase(
    @Param('id') id: string,
    @Body() cancelPurchaseDto: CancelPurchaseDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.purchasesService.cancelPurchase(
        id,
        cancelPurchaseDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('purchases.controller.ts', 'cancelPurchase', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to cancel purchase');
    }
  }

  @Get('/:id/cancel-impact')
  @ApiOperation({
    summary: 'Preview what cancelling this purchase would change',
    description:
      'WF12 step 3 — shows the impact BEFORE anything is saved: stock that leaves the shelf (phones → VOIDED, accessories −qty), ' +
      'the cash that would come back (one IN per ACTIVE supplier payment on this bill) with the resulting drawer balance, ' +
      'and the supplier payable after the cancel. blocked=true means the confirm would be refused ' +
      '(a phone is no longer IN_STOCK, or accessory stock is short) with the reason in the same words the 400 would use. ' +
      'Read-only — writes nothing. 400 if the purchase is already cancelled, 404 cross-shop.',
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
      const res = await this.purchasesService.getCancelImpact(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Cancel impact fetched successfully',
        res,
      );
    } catch (error) {
      logError('purchases.controller.ts', 'getCancelImpact', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch cancel impact');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List purchases',
    description:
      'Paginated list scoped to the shop in the JWT. Filter by supplier, status, opening-stock flag and a purchaseDate range; search matches the purchase number, the supplier invoice reference and the supplier name.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Purchases fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getPurchases(
    @Query() query: PurchaseQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponsePurchaseDto>>> {
    try {
      const res = await this.purchasesService.getPurchases(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Purchases fetched successfully', res);
    } catch (error) {
      logError('purchases.controller.ts', 'getPurchases', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch purchases');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one purchase by id',
    description:
      'Returns the purchase header plus every line, resolved product name and the IMEIs created from that line. 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponsePurchaseDto, 'Purchase fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getPurchaseById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponsePurchaseDto>> {
    try {
      const res = await this.purchasesService.getPurchaseById(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Purchase fetched successfully', res);
    } catch (error) {
      logError('purchases.controller.ts', 'getPurchaseById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch purchase');
    }
  }
}

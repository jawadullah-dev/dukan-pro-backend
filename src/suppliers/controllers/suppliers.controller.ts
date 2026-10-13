import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  HttpException,
  InternalServerErrorException,
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
  FORBIDDEN_REQUEST_RESPONSE,
  INTERNAL_SERVER_ERROR_RESPONSE,
  NOT_FOUND_REQUEST_RESPONSE,
  OK_RESPONSE_STATUS,
  UNAUTHORIZED_REQUEST_RESPONSE,
} from '../../constants/error-response.constant.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { ApiSuccessResponseDTO } from '../../common-dto/response/api-success-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import { SuppliersService } from '../services/suppliers.service.js';
import { CreateSupplierDto } from '../dto/create-supplier.dto.js';
import { UpdateSupplierDto } from '../dto/update-supplier.dto.js';
import { SupplierQueryFilterDto } from '../dto/supplier-query.filter.js';
import { LedgerQueryFilterDto } from '../dto/ledger-query.filter.js';
import { ResponseSupplierDto } from '../dto/response-supplier.dto.js';
import { SupplierLedgerDto } from '../dto/response-supplier-ledger.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('suppliers')
@Controller('suppliers')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Create a supplier',
    description:
      'Saves a person or company the shop buys from (WF5). openingBalance is what you already owed them on day one, in PAISA. Supplier names are NOT unique — the database allows two suppliers with the same name. isSystem cannot be set here; only onboarding creates the protected "Walk-in seller".',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Supplier created successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async createSupplier(
    @Body() createSupplierDto: CreateSupplierDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.suppliersService.createSupplier(
        createSupplierDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO('Supplier created successfully', res);
    } catch (error) {
      logError('suppliers.controller.ts', 'createSupplier', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to create supplier');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List suppliers',
    description:
      'Paginated list scoped to the shop in the JWT. Supports a contains search across name, phone and address, an isActive filter, sorting and paging.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Suppliers fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getSuppliers(
    @Query() query: SupplierQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseSupplierDto>>> {
    try {
      const res = await this.suppliersService.getSuppliers(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Suppliers fetched successfully', res);
    } catch (error) {
      logError('suppliers.controller.ts', 'getSuppliers', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch suppliers');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one supplier by id',
    description:
      'Returns a single supplier. Returns 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseSupplierDto, 'Supplier fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getSupplierById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseSupplierDto>> {
    try {
      const res = await this.suppliersService.getSupplierById(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Supplier fetched successfully', res);
    } catch (error) {
      logError('suppliers.controller.ts', 'getSupplierById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch supplier');
    }
  }

  @Get('/:id/ledger')
  @ApiOperation({
    summary: 'Supplier ledger (WF11)',
    description:
      'Current payable plus the timeline that explains it: every real purchase and supplier payment for this supplier, oldest first, with a running balance. Cancelled rows stay visible with delta 0 and never move the balance. Opening-stock purchases create no payable and are not listed, so balance always matches GET /supplier-payments/payable/{id}.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      SupplierLedgerDto,
      'Supplier ledger fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getSupplierLedger(
    @Param('id') id: string,
    @Query() query: LedgerQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<SupplierLedgerDto>> {
    try {
      const res = await this.suppliersService.getSupplierLedger(
        id,
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Supplier ledger fetched successfully',
        res,
      );
    } catch (error) {
      logError('suppliers.controller.ts', 'getSupplierLedger', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch supplier ledger');
    }
  }

  @Patch('/:id')
  @ApiOperation({
    summary: 'Update a supplier',
    description:
      'Partial update. Only the fields you send are changed. The system "Walk-in seller" row (isSystem) cannot be renamed or deactivated — either one returns 403.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Supplier updated successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async updateSupplier(
    @Param('id') id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.suppliersService.updateSupplier(
        id,
        updateSupplierDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO('Supplier updated successfully', res);
    } catch (error) {
      logError('suppliers.controller.ts', 'updateSupplier', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update supplier');
    }
  }

  @Delete('/:id')
  @ApiOperation({
    summary: 'Deactivate a supplier',
    description:
      'Soft delete. Sets isActive to false and keeps the row so old purchases still show who they came from. Nothing is ever removed. The system "Walk-in seller" cannot be deactivated — 403.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Supplier deactivated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async deleteSupplier(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.suppliersService.deleteSupplier(
        id,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(
        'Supplier deactivated successfully',
        res,
      );
    } catch (error) {
      logError('suppliers.controller.ts', 'deleteSupplier', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to deactivate supplier');
    }
  }
}

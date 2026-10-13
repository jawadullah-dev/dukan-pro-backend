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
  INTERNAL_SERVER_ERROR_RESPONSE,
  NOT_FOUND_REQUEST_RESPONSE,
  OK_RESPONSE_STATUS,
  UNAUTHORIZED_REQUEST_RESPONSE,
} from '../../constants/error-response.constant.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { ApiSuccessResponseDTO } from '../../common-dto/response/api-success-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import { CustomersService } from '../services/customers.service.js';
import { CreateCustomerDto } from '../dto/create-customer.dto.js';
import { UpdateCustomerDto } from '../dto/update-customer.dto.js';
import { CustomerQueryFilterDto } from '../dto/customer-query.filter.js';
import { LedgerQueryFilterDto } from '../dto/ledger-query.filter.js';
import { ResponseCustomerDto } from '../dto/response-customer.dto.js';
import { CustomerLedgerDto } from '../dto/response-customer-ledger.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('customers')
@Controller('customers')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Create a customer',
    description:
      'Creates one customer for the shop in the JWT. Only the name is required. openingBalance (old Udhar, in paisa) can be set here or corrected later with PATCH. Walk-in sales use no customer.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Customer created successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async createCustomer(
    @Body() createCustomerDto: CreateCustomerDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.customersService.createCustomer(
        createCustomerDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO('Customer created successfully', res);
    } catch (error) {
      logError('customers.controller.ts', 'createCustomer', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to create customer');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List customers',
    description:
      'Paginated list scoped to the shop in the JWT. Supports name or phone search, isActive filter and sorting.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Customers fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getCustomers(
    @Query() query: CustomerQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseCustomerDto>>> {
    try {
      const res = await this.customersService.getCustomers(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Customers fetched successfully', res);
    } catch (error) {
      logError('customers.controller.ts', 'getCustomers', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch customers');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one customer by id',
    description:
      'Returns a single customer. Returns 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseCustomerDto, 'Customer fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getCustomerById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseCustomerDto>> {
    try {
      const res = await this.customersService.getCustomerById(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Customer fetched successfully', res);
    } catch (error) {
      logError('customers.controller.ts', 'getCustomerById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch customer');
    }
  }

  @Get('/:id/ledger')
  @ApiOperation({
    summary: 'Customer ledger (WF11)',
    description:
      'Current Udhar plus the full timeline that explains it: every sale and payment for this customer in this shop, oldest first, with a running balance. Cancelled rows stay visible with delta 0 and never move the balance. Derived from the real records — there is no ledger table.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      CustomerLedgerDto,
      'Customer ledger fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getCustomerLedger(
    @Param('id') id: string,
    @Query() query: LedgerQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<CustomerLedgerDto>> {
    try {
      const res = await this.customersService.getCustomerLedger(
        id,
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Customer ledger fetched successfully',
        res,
      );
    } catch (error) {
      logError('customers.controller.ts', 'getCustomerLedger', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch customer ledger');
    }
  }

  @Patch('/:id')
  @ApiOperation({
    summary: 'Update a customer',
    description:
      'Partial update. Only the fields you send are changed. Null on phone/address/notes clears that field; null on name is rejected. openingBalance can be corrected here. Setting isActive to false hides the customer without deleting it.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Customer updated successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async updateCustomer(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.customersService.updateCustomer(
        id,
        updateCustomerDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO('Customer updated successfully', res);
    } catch (error) {
      logError('customers.controller.ts', 'updateCustomer', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update customer');
    }
  }

  @Delete('/:id')
  @ApiOperation({
    summary: 'Deactivate a customer',
    description:
      'Soft delete. Sets isActive to false and keeps the row so historical sales and payments keep their customer. Nothing is ever removed.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Customer deactivated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async deleteCustomer(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.customersService.deleteCustomer(
        id,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(
        'Customer deactivated successfully',
        res,
      );
    } catch (error) {
      logError('customers.controller.ts', 'deleteCustomer', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to deactivate customer');
    }
  }
}

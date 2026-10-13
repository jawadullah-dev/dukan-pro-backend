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
import { ExpenseCategoriesService } from '../services/expense-categories.service.js';
import { CreateExpenseCategoryDto } from '../dto/create-expense-category.dto.js';
import { UpdateExpenseCategoryDto } from '../dto/update-expense-category.dto.js';
import { ExpenseCategoryQueryFilterDto } from '../dto/expense-category-query.filter.js';
import { ResponseExpenseCategoryDto } from '../dto/response-expense-category.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('expense-categories')
@Controller('expense-categories')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class ExpenseCategoriesController {
  constructor(
    private readonly expenseCategoriesService: ExpenseCategoriesService,
  ) {}

  @Post('/')
  @ApiOperation({
    summary: 'Create an expense category',
    description:
      'Creates one expense category (Rent, Electricity...) for the shop in the JWT. Name must be unique inside this shop (case-sensitive).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Expense category created successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async createExpenseCategory(
    @Body() createExpenseCategoryDto: CreateExpenseCategoryDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.expenseCategoriesService.createExpenseCategory(
        createExpenseCategoryDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(
        'Expense category created successfully',
        res,
      );
    } catch (error) {
      logError(
        'expense-categories.controller.ts',
        'createExpenseCategory',
        error,
        { shopId: req.user?.shopId },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to create expense category',
      );
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List expense categories',
    description:
      'Paginated list scoped to the shop in the JWT. Supports name search, isActive filter and sorting by name.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PaginatedResponseDTO,
      'Expense categories fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getExpenseCategories(
    @Query() query: ExpenseCategoryQueryFilterDto,
    @Req() req: any,
  ): Promise<
    ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseExpenseCategoryDto>>
  > {
    try {
      const res = await this.expenseCategoriesService.getExpenseCategories(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Expense categories fetched successfully',
        res,
      );
    } catch (error) {
      logError(
        'expense-categories.controller.ts',
        'getExpenseCategories',
        error,
        { shopId: req.user?.shopId, query },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch expense categories',
      );
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one expense category by id',
    description:
      'Returns a single expense category. Returns 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ResponseExpenseCategoryDto,
      'Expense category fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getExpenseCategoryById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseExpenseCategoryDto>> {
    try {
      const res = await this.expenseCategoriesService.getExpenseCategoryById(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Expense category fetched successfully',
        res,
      );
    } catch (error) {
      logError(
        'expense-categories.controller.ts',
        'getExpenseCategoryById',
        error,
        { shopId: req.user?.shopId, id },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch expense category',
      );
    }
  }

  @Patch('/:id')
  @ApiOperation({
    summary: 'Update an expense category',
    description:
      'Partial update. Only the fields you send are changed. Setting isActive to false hides the category without deleting it.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Expense category updated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async updateExpenseCategory(
    @Param('id') id: string,
    @Body() updateExpenseCategoryDto: UpdateExpenseCategoryDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.expenseCategoriesService.updateExpenseCategory(
        id,
        updateExpenseCategoryDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(
        'Expense category updated successfully',
        res,
      );
    } catch (error) {
      logError(
        'expense-categories.controller.ts',
        'updateExpenseCategory',
        error,
        { shopId: req.user?.shopId, id },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to update expense category',
      );
    }
  }

  @Delete('/:id')
  @ApiOperation({
    summary: 'Deactivate an expense category',
    description:
      'Soft delete. Sets isActive to false and keeps the row so historical expenses keep their category. Nothing is ever removed.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Expense category deactivated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async deleteExpenseCategory(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.expenseCategoriesService.deleteExpenseCategory(
        id,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(
        'Expense category deactivated successfully',
        res,
      );
    } catch (error) {
      logError(
        'expense-categories.controller.ts',
        'deleteExpenseCategory',
        error,
        { shopId: req.user?.shopId, id },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to deactivate expense category',
      );
    }
  }
}

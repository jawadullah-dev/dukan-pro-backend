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
import {
  ExpensesService,
  CreateExpenseResult,
} from '../services/expenses.service.js';
import { CreateExpenseDto } from '../dto/create-expense.dto.js';
import { CancelExpenseDto } from '../dto/cancel-expense.dto.js';
import { ExpenseQueryFilterDto } from '../dto/expense-query.filter.js';
import { ResponseExpenseDto } from '../dto/response-expense.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('expenses')
@Controller('expenses')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Record an expense',
    description:
      'WF13 — records an operating cost (rent, electricity, salary...). ' +
      'Inserts an expense row (ACTIVE) and a cash_movements row (EXPENSE, OUT) in one transaction. ' +
      'If the amount would take cash below zero the response is 200 ' +
      '{ confirmOverdraft: true, shortfall, message }; resend the same body plus confirmOverdraft: true to save ' +
      '(the cash row is then flagged isOverdraft). ' +
      'Buying stock is not an expense — use POST /purchases for that.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Expense recorded successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async createExpense(
    @Body() createExpenseDto: CreateExpenseDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<CreateExpenseResult>> {
    try {
      const result = await this.expensesService.createExpense(
        createExpenseDto,
        req.user.shopId,
        req.user.userId,
      );
      // Overdraft prompt writes nothing — must not claim 201.
      res.status('confirmOverdraft' in result ? 200 : 201);
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('expenses.controller.ts', 'createExpense', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to record expense');
    }
  }

  @Post('/:id/cancel')
  @ApiOperation({
    summary: 'Cancel an expense',
    description:
      'WF13 — cancels a wrong expense. Sets status to CANCELLED and adds a cash_movements REVERSAL (IN) ' +
      'row pointing back to the original movement. A reason is required. ' +
      'Already-cancelled expenses return 400.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Expense cancelled successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async cancelExpense(
    @Param('id') id: string,
    @Body() cancelExpenseDto: CancelExpenseDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const result = await this.expensesService.cancelExpense(
        id,
        cancelExpenseDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(result.message, result);
    } catch (error) {
      logError('expenses.controller.ts', 'cancelExpense', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to cancel expense');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List expenses',
    description:
      'Paginated list scoped to the shop in the JWT. Filter by categoryId, status and an expenseDate range. ' +
      'Search matches the description. Cancelled expenses are included unless status=ACTIVE is passed.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Expenses fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getExpenses(
    @Query() query: ExpenseQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseExpenseDto>>> {
    try {
      const result = await this.expensesService.getExpenses(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Expenses fetched successfully', result);
    } catch (error) {
      logError('expenses.controller.ts', 'getExpenses', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch expenses');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one expense by id',
    description:
      'Returns a single expense with its category name. 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseExpenseDto, 'Expense fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getExpenseById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseExpenseDto>> {
    try {
      const result = await this.expensesService.getExpenseById(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Expense fetched successfully', result);
    } catch (error) {
      logError('expenses.controller.ts', 'getExpenseById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch expense');
    }
  }
}

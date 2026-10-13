import {
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
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
import { DashboardService } from '../services/dashboard.service.js';
import { DashboardQueryFilterDto } from '../dto/dashboard-query.filter.js';
import { DashboardDto } from '../dto/response-dashboard.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('dashboard')
@Controller('dashboard')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('/')
  @ApiOperation({
    summary: 'Simple dashboard (WF14)',
    description:
      "Seven numbers for the shop in the JWT, all derived from live records with cancelled rows excluded: today's sales, today's net profit, customer Udhar, supplier payable, today's expenses, low-stock product count and cash position. Only period=today exists in Release 1; every number carries a link to the list that explains it.",
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(DashboardDto, 'Dashboard fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getDashboard(
    @Query() query: DashboardQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<DashboardDto>> {
    try {
      const res = await this.dashboardService.getDashboard(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Dashboard fetched successfully', res);
    } catch (error) {
      logError('dashboard.controller.ts', 'getDashboard', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch dashboard');
    }
  }
}

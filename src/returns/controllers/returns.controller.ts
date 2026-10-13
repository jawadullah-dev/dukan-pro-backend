import {
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
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
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import { ReturnsService } from '../services/returns.service.js';
import { ReturnQueryFilterDto } from '../dto/return-query.filter.js';
import { ResponseReturnDto } from '../dto/response-return.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('returns')
@Controller('returns')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  @Get('/')
  @ApiOperation({
    summary: 'List returns',
    description:
      'WF15 — paginated list scoped to the shop in the JWT. Filter by sale, customer and a returnDate range; search matches the sale number, customer name and reason. ' +
      'Every row carries its lines (product, IMEI, condition) and any refunds already given.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Returns fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getReturns(
    @Query() query: ReturnQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseReturnDto>>> {
    try {
      const res = await this.returnsService.getReturns(query, req.user.shopId);
      return new ApiSuccessResponseDTO('Returns fetched successfully', res);
    } catch (error) {
      logError('returns.controller.ts', 'getReturns', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch returns');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one return by id',
    description:
      'The return header, every returned line with product name / IMEI / condition, and the refunds recorded against it. 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseReturnDto, 'Return fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getReturnById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseReturnDto>> {
    try {
      const res = await this.returnsService.getReturnById(id, req.user.shopId);
      return new ApiSuccessResponseDTO('Return fetched successfully', res);
    } catch (error) {
      logError('returns.controller.ts', 'getReturnById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch return');
    }
  }
}

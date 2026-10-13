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
import { CategoriesService } from '../services/categories.service.js';
import { CreateCategoryDto } from '../dto/create-category.dto.js';
import { UpdateCategoryDto } from '../dto/update-category.dto.js';
import { CategoryQueryFilterDto } from '../dto/category-query.filter.js';
import { ResponseCategoryDto } from '../dto/response-category.dto.js';
import { logError } from '../../helpers/logger-helper.js';

@ApiTags('categories')
@Controller('categories')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Create a category',
    description:
      'Creates one category for the shop in the JWT. Name must be unique inside this shop (case-sensitive).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Category created successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async createCategory(
    @Body() createCategoryDto: CreateCategoryDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.categoriesService.createCategory(
        createCategoryDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO('Category created successfully', res);
    } catch (error) {
      logError('categories.controller.ts', 'createCategory', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to create category');
    }
  }

  @Get('/')
  @ApiOperation({
    summary: 'List categories',
    description:
      'Paginated list scoped to the shop in the JWT. Supports name search, isActive filter and sorting.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(PaginatedResponseDTO, 'Categories fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getCategories(
    @Query() query: CategoryQueryFilterDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseCategoryDto>>> {
    try {
      const res = await this.categoriesService.getCategories(
        query,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Categories fetched successfully', res);
    } catch (error) {
      logError('categories.controller.ts', 'getCategories', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch categories');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Get one category by id',
    description:
      'Returns a single category. Returns 404 if it does not exist or belongs to another shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseCategoryDto, 'Category fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getCategoryById(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseCategoryDto>> {
    try {
      const res = await this.categoriesService.getCategoryById(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Category fetched successfully', res);
    } catch (error) {
      logError('categories.controller.ts', 'getCategoryById', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch category');
    }
  }

  @Patch('/:id')
  @ApiOperation({
    summary: 'Update a category',
    description:
      'Partial update. Only the fields you send are changed. Setting isActive to false hides the category without deleting it.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Category updated successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async updateCategory(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.categoriesService.updateCategory(
        id,
        updateCategoryDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO('Category updated successfully', res);
    } catch (error) {
      logError('categories.controller.ts', 'updateCategory', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update category');
    }
  }

  @Delete('/:id')
  @ApiOperation({
    summary: 'Deactivate a category',
    description:
      'Soft delete. Sets isActive to false and keeps the row so historical products keep their category. Nothing is ever removed.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Category deactivated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async deleteCategory(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.categoriesService.deleteCategory(
        id,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(
        'Category deactivated successfully',
        res,
      );
    } catch (error) {
      logError('categories.controller.ts', 'deleteCategory', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to deactivate category');
    }
  }
}

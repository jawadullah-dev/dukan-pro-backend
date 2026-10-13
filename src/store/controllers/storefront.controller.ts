import {
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { RateLimitGuard } from '../guards/rate-limit.guard.js';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiSuccessResponseDecorator } from '../../common-dto/decorator/ApiSuccessResponseDecorator.js';
import {
  BAD_REQUEST_RESPONSE,
  INTERNAL_SERVER_ERROR_RESPONSE,
  NOT_FOUND_REQUEST_RESPONSE,
  OK_RESPONSE_STATUS,
} from '../../constants/error-response.constant.js';
import { ApiSuccessResponseDTO } from '../../common-dto/response/api-success-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  ResponseStoreDto,
  ResponseStoreProductDto,
  ResponseStoreCategoriesDto,
} from '../dto/response-storefront.dto.js';
import { StoreProductsQueryDto } from '../dto/store-products-query.dto.js';
import { logError } from '../../helpers/logger-helper.js';
import { StorefrontService } from '../services/storefront.service.js';

/** WF22 step 8 — let the CDN answer repeated catalog reads for a minute. */
const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

/**
 * Public, UNauthenticated storefront (WF22). This is the link customers
 * share / scan — it must work without a token. Never put a shop id here;
 * everything is looked up by the store slug, and every failure answers with
 * the same "store not available" body.
 */
@ApiTags('storefront')
@Controller('public/stores')
// WF22 step 8 — rate limited per IP so one crawler cannot hammer the catalog.
@UseGuards(RateLimitGuard)
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get('/:slug')
  @ApiOperation({
    summary: 'Public store profile by slug',
    description:
      "NO authentication. The store's public face: name, about, logo, banner, WhatsApp, address and social links. 404 'Store not available' when the slug is unknown, the store is OFF or the shop is suspended — the three cases are indistinguishable on purpose.",
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseStoreDto, 'Store fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getStore(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<ResponseStoreDto>> {
    try {
      const data = await this.storefrontService.getStore(slug);
      res.set('Cache-Control', CACHE_CONTROL);
      return new ApiSuccessResponseDTO('Store fetched successfully', data);
    } catch (error) {
      logError('storefront.controller.ts', 'getStore', error, { slug });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch store');
    }
  }

  @Get('/:slug/categories')
  @ApiOperation({
    summary: 'Categories and brands on the store',
    description:
      'Every category and brand that has at least one published, active product — the filter chips of the store.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ResponseStoreCategoriesDto,
      'Store categories fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getCategories(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<ResponseStoreCategoriesDto>> {
    try {
      const data = await this.storefrontService.getCategories(slug);
      res.set('Cache-Control', CACHE_CONTROL);
      return new ApiSuccessResponseDTO(
        'Store categories fetched successfully',
        data,
      );
    } catch (error) {
      logError('storefront.controller.ts', 'getCategories', error, { slug });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch store categories',
      );
    }
  }

  @Get('/:slug/products')
  @ApiOperation({
    summary: 'Published products on the store',
    description:
      'One page of published, ACTIVE products, newest first. Filters: category and brand (id or exact name), q (name contains). limit max 50. Availability comes from stock_levels or a grouped IN_STOCK unit count; exact stockCount only when showExactStock is on.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PaginatedResponseDTO,
      'Store products fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getProducts(
    @Param('slug') slug: string,
    @Query() query: StoreProductsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseStoreProductDto>>
  > {
    try {
      const data = await this.storefrontService.getProducts(slug, query);
      res.set('Cache-Control', CACHE_CONTROL);
      return new ApiSuccessResponseDTO(
        'Store products fetched successfully',
        data,
      );
    } catch (error) {
      logError('storefront.controller.ts', 'getProducts', error, {
        slug,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch store products');
    }
  }

  @Get('/:slug/products/:productId')
  @ApiOperation({
    summary: 'One product on the store',
    description:
      'A single published, ACTIVE product of this store. A product id from another shop, an unpublished or an inactive product all return the same 404.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ResponseStoreProductDto,
      'Store product fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getProduct(
    @Param('slug') slug: string,
    @Param('productId') productId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiSuccessResponseDTO<ResponseStoreProductDto>> {
    try {
      const data = await this.storefrontService.getProduct(slug, productId);
      res.set('Cache-Control', CACHE_CONTROL);
      return new ApiSuccessResponseDTO(
        'Store product fetched successfully',
        data,
      );
    } catch (error) {
      logError('storefront.controller.ts', 'getProduct', error, {
        slug,
        productId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch store product');
    }
  }
}

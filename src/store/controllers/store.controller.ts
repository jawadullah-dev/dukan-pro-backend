import {
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
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
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import { logError } from '../../helpers/logger-helper.js';
import { StoreService } from '../services/store.service.js';
import { StorefrontService } from '../services/storefront.service.js';
import { UpdateStoreSettingsDto } from '../dto/update-store-settings.dto.js';
import { ResponseStoreSettingsDto } from '../dto/response-store-settings.dto.js';
import { StoreProductsQueryDto } from '../dto/store-products-query.dto.js';
import {
  ResponseStoreDto,
  ResponseStoreProductDto,
  ResponseStoreCategoriesDto,
} from '../dto/response-storefront.dto.js';

@ApiTags('store')
@Controller('store')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class StoreController {
  constructor(
    private readonly storeService: StoreService,
    private readonly storefrontService: StorefrontService,
  ) {}

  @Get('/settings')
  @ApiOperation({
    summary: 'Get store settings',
    description:
      "Returns this shop's store settings. 404 when the shop has not configured a store yet (create one with PATCH /store/settings).",
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ResponseStoreSettingsDto,
      'Store settings fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getSettings(
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseStoreSettingsDto>> {
    try {
      const res = await this.storeService.getSettings(req.user.shopId);
      return new ApiSuccessResponseDTO(
        'Store settings fetched successfully',
        res,
      );
    } catch (error) {
      logError('store.controller.ts', 'getSettings', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch store settings');
    }
  }

  @Patch('/settings')
  @ApiOperation({
    summary: 'Create or update store settings',
    description:
      "Upserts the shop's store settings. When the shop has none yet, a row is created (displayName defaults to the shop name). Sending null on displayName or slug is a 400.",
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Store settings updated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async updateSettings(
    @Body() updateStoreSettingsDto: UpdateStoreSettingsDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.storeService.updateSettings(
        updateStoreSettingsDto,
        req.user.shopId,
        req.user.userId,
      );
      return new ApiSuccessResponseDTO(
        'Store settings updated successfully',
        res,
      );
    } catch (error) {
      logError('store.controller.ts', 'updateSettings', error, {
        shopId: req.user?.shopId,
        dto: updateStoreSettingsDto,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update store settings');
    }
  }

  // -------------------------------------------------------------------------
  // WF19 step 5 — preview: the store exactly as customers will see it,
  // for THIS shop, even while the store is still OFF.
  // -------------------------------------------------------------------------

  @Get('/preview')
  @ApiOperation({
    summary: 'Preview the public store profile',
    description:
      "Same output as GET /public/stores/{slug} for this shop, even while the store is OFF. Requires the owner's login.",
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseStoreDto, 'Store preview fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getPreview(
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseStoreDto>> {
    try {
      const res = await this.storefrontService.getPreviewStore(req.user.shopId);
      return new ApiSuccessResponseDTO(
        'Store preview fetched successfully',
        res,
      );
    } catch (error) {
      logError('store.controller.ts', 'getPreview', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch store preview');
    }
  }

  @Get('/preview/categories')
  @ApiOperation({
    summary: 'Preview store categories and brands',
    description:
      'Same output as GET /public/stores/{slug}/categories — published, active products only.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ResponseStoreCategoriesDto,
      'Store preview categories fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getPreviewCategories(
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseStoreCategoriesDto>> {
    try {
      const res = await this.storefrontService.getPreviewCategories(
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Store preview categories fetched successfully',
        res,
      );
    } catch (error) {
      logError('store.controller.ts', 'getPreviewCategories', error, {
        shopId: req.user?.shopId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch store preview categories',
      );
    }
  }

  @Get('/preview/products')
  @ApiOperation({
    summary: 'Preview store products',
    description:
      'Same output as GET /public/stores/{slug}/products — one page of published, active products, newest first.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PaginatedResponseDTO,
      'Store preview products fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getPreviewProducts(
    @Query() query: StoreProductsQueryDto,
    @Req() req: any,
  ): Promise<
    ApiSuccessResponseDTO<PaginatedResponseDTO<ResponseStoreProductDto>>
  > {
    try {
      const res = await this.storefrontService.getPreviewProducts(
        req.user.shopId,
        query,
      );
      return new ApiSuccessResponseDTO(
        'Store preview products fetched successfully',
        res,
      );
    } catch (error) {
      logError('store.controller.ts', 'getPreviewProducts', error, {
        shopId: req.user?.shopId,
        query,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch store preview products',
      );
    }
  }

  @Get('/preview/products/:productId')
  @ApiOperation({
    summary: 'Preview one store product',
    description:
      'Same output as GET /public/stores/{slug}/products/{productId} for this shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      ResponseStoreProductDto,
      'Store preview product fetched successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getPreviewProduct(
    @Param('productId') productId: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseStoreProductDto>> {
    try {
      const res = await this.storefrontService.getPreviewProduct(
        req.user.shopId,
        productId,
      );
      return new ApiSuccessResponseDTO(
        'Store preview product fetched successfully',
        res,
      );
    } catch (error) {
      logError('store.controller.ts', 'getPreviewProduct', error, {
        shopId: req.user?.shopId,
        productId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to fetch store preview product',
      );
    }
  }

  @Post('/products/:id/publish')
  @ApiOperation({
    summary: 'Publish a product',
    description:
      'Makes an ACTIVE product visible in the public store. The DB trigger backfills publishedAt. Only active products can be published.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Product published successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async publishProduct(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.storeService.publishProduct(id, req.user.shopId);
      return new ApiSuccessResponseDTO('Product published successfully', res);
    } catch (error) {
      logError('store.controller.ts', 'publishProduct', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to publish product');
    }
  }

  @Post('/products/:id/unpublish')
  @ApiOperation({
    summary: 'Unpublish a product',
    description:
      'Hides a product from the public store. The DB trigger clears publishedAt.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Product unpublished successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async unpublishProduct(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.storeService.unpublishProduct(id, req.user.shopId);
      return new ApiSuccessResponseDTO('Product unpublished successfully', res);
    } catch (error) {
      logError('store.controller.ts', 'unpublishProduct', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to unpublish product');
    }
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { logError } from '../../helpers/logger-helper.js';
import { photoFileRequired } from '../../errors/error.builder.js';
import { StoreService } from '../services/store.service.js';
import { ReorderProductImagesDto } from '../dto/reorder-product-images.dto.js';
import { ResponseProductImagesDto } from '../dto/response-product-image.dto.js';
import type { UploadedImageFile } from '../dto/uploaded-image-file.type.js';

/**
 * WF21 photo routes live under the product path (`/products/:id/images…`)
 * exactly as the Online Store API table specifies, but the image rules
 * (max 5, https-only via R2, order-as-full-list) belong to StoreService — so
 * this controller is registered by StoreModule with the `products` prefix
 * instead of moving that logic into ProductsService.
 */
@ApiTags('products')
@Controller('products')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class ProductImagesController {
  constructor(private readonly storeService: StoreService) {}

  @Get('/:id/images')
  @ApiOperation({
    summary: 'List a product’s images',
    description:
      'Returns the saved photos ordered by sortOrder ascending — index 0 is the cover. Tenanted to the JWT shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ResponseProductImagesDto, 'Product images fetched'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  async getProductImages(
    @Param('id') id: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<ResponseProductImagesDto>> {
    try {
      const images = await this.storeService.listProductImages(
        id,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Product images fetched successfully', {
        items: images,
      });
    } catch (error) {
      logError('product-images.controller.ts', 'getProductImages', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch product images');
    }
  }

  @Post('/:id/images')
  @ApiOperation({
    summary: 'Upload a product image',
    description:
      'Multipart upload (field "image"). The app validates it as a real JPEG/PNG/WebP by content, strips GPS/metadata, caps it at ~1600px, stores it in Cloudflare R2 and appends one product_images row (max 5).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Photo file (JPEG, PNG or WebP), named "image"',
    schema: {
      type: 'object',
      properties: {
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 15 * 1024 * 1024 } }),
  )
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Product image added successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async addProductImage(
    @Param('id') id: string,
    @UploadedFile() file: UploadedImageFile,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      if (!file || !file.buffer) {
        throw new BadRequestException(photoFileRequired());
      }
      const res = await this.storeService.addProductImage(
        id,
        file,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO('Product image added successfully', res);
    } catch (error) {
      logError('product-images.controller.ts', 'addProductImage', error, {
        shopId: req.user?.shopId,
        id,
        size: file?.size,
        mimetype: file?.mimetype,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to add product image');
    }
  }

  @Patch('/:id/images/order')
  @ApiOperation({
    summary: 'Reorder product images',
    description:
      "Send the FULL ordered list of this product's image ids. The first becomes the cover. Any list that is not exactly the saved images is a 400.",
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Product images reordered successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async reorderProductImages(
    @Param('id') id: string,
    @Body() reorderProductImagesDto: ReorderProductImagesDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.storeService.reorderProductImages(
        id,
        reorderProductImagesDto,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Product images reordered successfully',
        res,
      );
    } catch (error) {
      logError('product-images.controller.ts', 'reorderProductImages', error, {
        shopId: req.user?.shopId,
        id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to reorder product images',
      );
    }
  }

  @Delete('/:id/images/:imageId')
  @ApiOperation({
    summary: 'Remove a product image',
    description:
      'Deletes one photo (and its R2 object if it came from this bucket). The remaining images keep their order; the lowest sortOrder is still the cover.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Product image removed successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async removeProductImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.storeService.removeProductImage(
        id,
        imageId,
        req.user.shopId,
      );
      return new ApiSuccessResponseDTO(
        'Product image removed successfully',
        res,
      );
    } catch (error) {
      logError('product-images.controller.ts', 'removeProductImage', error, {
        shopId: req.user?.shopId,
        id,
        imageId,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to remove product image');
    }
  }
}

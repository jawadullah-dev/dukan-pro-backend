import {
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  FORBIDDEN_REQUEST_RESPONSE,
  INTERNAL_SERVER_ERROR_RESPONSE,
  NOT_FOUND_REQUEST_RESPONSE,
  OK_RESPONSE_STATUS,
  UNAUTHORIZED_REQUEST_RESPONSE,
} from '../../constants/error-response.constant.js';
import { ApiSuccessResponseDTO } from '../../common-dto/response/api-success-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PlatformAdminGuard } from '../../auth-guards/platform-admin.guard.js';
import { logError } from '../../helpers/logger-helper.js';
import { PlatformAdminService } from '../services/platform-admin.service.js';
import { CreateShopDto } from '../dto/create-shop.dto.js';
import { CreateShopResponseDto } from '../dto/create-shop-response.dto.js';
import { UpdateSubscriptionDto } from '../dto/update-subscription.dto.js';
import { UpdateSubscriptionResponseDto } from '../dto/update-subscription-response.dto.js';
import { ShopOwnerStatusResponseDto } from '../dto/shop-owner-status-response.dto.js';
import { ChangeStoreSlugDto } from '../dto/change-store-slug.dto.js';

/**
 * SaaS admin panel API: onboard shops and manage subscriptions.
 *
 * Every route is behind PlatformAdminGuard, so an owner token cannot reach any
 * of them — an owner has no business creating shops or extending subscriptions.
 */
@ApiTags('platform-admin-shops')
@Controller('platform-admin/shops')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
export class PlatformAdminShopsController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Post('/')
  @ApiOperation({
    summary: 'Onboard a new shop (WF1)',
    description:
      'Creates the shop, its owner, the starter categories and expense categories, the protected "Walk-in seller" supplier, and the owner\'s one-time password setup link — all in one transaction. The returned setupUrl is shown ONCE; forward it to the owner on WhatsApp. Opening cash and old Udhar are entered by the owner afterwards.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(CreateShopResponseDto, 'Shop created successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async createShop(
    @Body() createShopDto: CreateShopDto,
  ): Promise<ApiSuccessResponseDTO<CreateShopResponseDto>> {
    try {
      const res = await this.platformAdminService.createShop(createShopDto);
      return new ApiSuccessResponseDTO('Shop created successfully', res);
    } catch (error) {
      logError('platform-admin.controller.ts', 'createShop', error);
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to create shop');
    }
  }

  @Get('/:id')
  @ApiOperation({
    summary: 'Shop onboarding status',
    description:
      'Tells the admin whether a shop already has an owner and whether that owner has set a password yet — the two things needed to decide between reissuing a setup link and creating the shop.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(ShopOwnerStatusResponseDto, 'Shop fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getShopOwner(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessResponseDTO<ShopOwnerStatusResponseDto>> {
    try {
      const res = await this.platformAdminService.getShopOwner(id);
      return new ApiSuccessResponseDTO('Shop fetched successfully', res);
    } catch (error) {
      logError('platform-admin.controller.ts', 'getShopOwner', error, {
        shopId: id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to fetch shop');
    }
  }

  @Patch('/:id/subscription')
  @ApiOperation({
    summary: 'Renew or suspend a subscription (WF3)',
    description:
      'Send subscriptionEndsAt to renew and reactivate the shop. Send isActive:false to suspend immediately, or isActive:true to reactivate without changing the date. When sending both, isActive:false keeps the shop suspended. A suspended or expired shop is blocked by the auth guard on the very next request.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      UpdateSubscriptionResponseDto,
      'Subscription updated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async updateSubscription(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() updateSubscriptionDto: UpdateSubscriptionDto,
  ): Promise<ApiSuccessResponseDTO<UpdateSubscriptionResponseDto>> {
    try {
      const res = await this.platformAdminService.updateSubscription(
        id,
        updateSubscriptionDto,
      );
      return new ApiSuccessResponseDTO(
        'Subscription updated successfully',
        res,
      );
    } catch (error) {
      logError('platform-admin.controller.ts', 'updateSubscription', error, {
        shopId: id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update subscription');
    }
  }

  @Patch('/:id/store-slug')
  @ApiOperation({
    summary: 'Change a shop store slug (WF19)',
    description:
      'Only a platform admin may change the store address. Changing it breaks shared links and QR codes — use with care. The new slug must be lowercase letters/numbers with single hyphens, 3–40 chars and not a reserved word; duplicate slugs are a 400.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      StatusBaseResponseDTO,
      'Store slug updated successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async changeStoreSlug(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() changeStoreSlugDto: ChangeStoreSlugDto,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.platformAdminService.changeStoreSlug(
        id,
        changeStoreSlugDto,
      );
      return new ApiSuccessResponseDTO('Store slug updated successfully', res);
    } catch (error) {
      logError('platform-admin.controller.ts', 'changeStoreSlug', error, {
        shopId: id,
      });
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException('Failed to update store slug');
    }
  }
}

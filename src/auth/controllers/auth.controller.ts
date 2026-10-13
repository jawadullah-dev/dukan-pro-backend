import {
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Post,
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
  FORBIDDEN_REQUEST_RESPONSE,
  INTERNAL_SERVER_ERROR_RESPONSE,
  NOT_FOUND_REQUEST_RESPONSE,
  OK_RESPONSE_STATUS,
  UNAUTHORIZED_REQUEST_RESPONSE,
} from '../../constants/error-response.constant.js';
import { ApiSuccessResponseDTO } from '../../common-dto/response/api-success-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { logError } from '../../helpers/logger-helper.js';
import { AuthService } from '../services/auth.service.js';
import { OwnerLoginDto } from '../dto/owner-login.dto.js';
import { PlatformAdminLoginDto } from '../dto/platform-admin-login.dto.js';
import { SetupPasswordDto } from '../dto/setup-password.dto.js';
import { ChangePasswordDto } from '../dto/change-password.dto.js';
import {
  OwnerLoginResponseDto,
  PlatformAdminLoginResponseDto,
} from '../dto/login-response.dto.js';
import { MeResponseDto } from '../dto/me-response.dto.js';

/**
 * Preserve expected HTTP errors: a wrong password is a 401 and a suspended
 * shop is a 403. Unexpected failures become 500 without exposing internals.
 */
const rethrowOrDefault = (error: unknown, fallback: string): HttpException => {
  if (error instanceof HttpException) return error;
  return new InternalServerErrorException(fallback);
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Log in as a shop owner',
    description:
      'Phone + password returns a 24h JWT scoped to the owner\'s shop. Phone accepts any format (03001234567, 0300-1234567, +923001234567). If the shop subscription has ended the response is 403 with a specific "subscription has ended" message rather than a generic auth error.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(OwnerLoginResponseDto, 'Logged in successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async ownerLogin(
    @Body() ownerLoginDto: OwnerLoginDto,
  ): Promise<ApiSuccessResponseDTO<OwnerLoginResponseDto>> {
    try {
      const res = await this.authService.ownerLogin(ownerLoginDto);
      return new ApiSuccessResponseDTO('Logged in successfully', res);
    } catch (error) {
      logError('auth.controller.ts', 'ownerLogin', error);
      throw rethrowOrDefault(error, 'Failed to log in');
    }
  }

  @Post('platform-admin/login')
  @ApiOperation({
    summary: 'Log in as a Dukaan Pro platform admin',
    description:
      'Separate from owner login because platform admins live outside the tenant tables and have no shop_id. The returned token cannot open shop endpoints.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PlatformAdminLoginResponseDto,
      'Platform admin logged in successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async platformAdminLogin(
    @Body() platformAdminLoginDto: PlatformAdminLoginDto,
  ): Promise<ApiSuccessResponseDTO<PlatformAdminLoginResponseDto>> {
    try {
      const res = await this.authService.platformAdminLogin(
        platformAdminLoginDto,
      );
      return new ApiSuccessResponseDTO(
        'Platform admin logged in successfully',
        res,
      );
    } catch (error) {
      logError('auth.controller.ts', 'platformAdminLogin', error);
      throw rethrowOrDefault(error, 'Failed to log in');
    }
  }

  @Post('setup-password')
  @ApiOperation({
    summary: 'Set a password using a one-time setup link',
    description:
      'Called by the page the setup link opens. The token is single use and expires. Successful use clears the stored token, so the link cannot be replayed. This is also how a forgotten password is reset.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Password set successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async setupPassword(
    @Body() setupPasswordDto: SetupPasswordDto,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.authService.setupPassword(setupPasswordDto);
      return new ApiSuccessResponseDTO('Password set successfully', res);
    } catch (error) {
      logError('auth.controller.ts', 'setupPassword', error);
      throw rethrowOrDefault(error, 'Failed to set password');
    }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Current owner and shop summary',
    description:
      'Called by the PWA on every cold start to decide whether to show the app or the "subscription ended" screen.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(MeResponseDto, 'Current user fetched successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async getMe(@Req() req: any): Promise<ApiSuccessResponseDTO<MeResponseDto>> {
    try {
      const res = await this.authService.getMe(req.user.userId);
      return new ApiSuccessResponseDTO(
        'Current user fetched successfully',
        res,
      );
    } catch (error) {
      logError('auth.controller.ts', 'getMe', error, {
        shopId: req.user?.shopId,
      });
      throw rethrowOrDefault(error, 'Failed to fetch current user');
    }
  }

  @Post('change-password')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change your own password',
    description:
      'Requires the current password so a stolen token alone cannot lock the owner out. Tokens issued before the change stay valid until they expire (up to 24h).',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(StatusBaseResponseDTO, 'Password changed successfully'),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @Req() req: any,
  ): Promise<ApiSuccessResponseDTO<StatusBaseResponseDTO>> {
    try {
      const res = await this.authService.changePassword(
        req.user.userId,
        changePasswordDto,
      );
      return new ApiSuccessResponseDTO('Password changed successfully', res);
    } catch (error) {
      logError('auth.controller.ts', 'changePassword', error, {
        shopId: req.user?.shopId,
      });
      throw rethrowOrDefault(error, 'Failed to change password');
    }
  }
}

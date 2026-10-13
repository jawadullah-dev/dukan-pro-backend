import {
  Controller,
  HttpException,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
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
import { PlatformAdminGuard } from '../../auth-guards/platform-admin.guard.js';
import { logError } from '../../helpers/logger-helper.js';
import { AuthService } from '../services/auth.service.js';
import { PasswordSetupLinkResponseDto } from '../dto/password-setup-link-response.dto.js';

/**
 * Admin-only setup links.
 *
 * Deliberately its own controller: the guard is PlatformAdminGuard, so an owner
 * token can never reach a route that mints a password-setup link. The login
 * endpoint that gets an admin in the first place lives in AuthController because
 * it is public.
 */
@ApiTags('platform-admin-auth')
@Controller('platform-admin')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
export class PlatformAdminAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('users/:userId/password-setup-link')
  @ApiOperation({
    summary: 'Issue a one-time password setup link for a shop owner',
    description:
      'Dukaan Pro sends no email and no SMS. This response contains the complete URL to forward to the owner on WhatsApp. The token is stored only as a SHA-256 hash, so the URL cannot be recovered later — issue a new link instead. Issuing a link also resets the password, and invalidates any previous unused link.',
  })
  @ApiSuccessResponseDecorator(
    OK_RESPONSE_STATUS(
      PasswordSetupLinkResponseDto,
      'Password setup link issued successfully',
    ),
  )
  @ApiResponse(BAD_REQUEST_RESPONSE)
  @ApiResponse(UNAUTHORIZED_REQUEST_RESPONSE)
  @ApiResponse(FORBIDDEN_REQUEST_RESPONSE)
  @ApiResponse(INTERNAL_SERVER_ERROR_RESPONSE)
  @ApiResponse(NOT_FOUND_REQUEST_RESPONSE)
  async issuePasswordSetupLink(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<ApiSuccessResponseDTO<PasswordSetupLinkResponseDto>> {
    try {
      const res = await this.authService.issuePasswordSetupLink(userId);
      return new ApiSuccessResponseDTO(
        'Password setup link issued successfully',
        res,
      );
    } catch (error) {
      logError(
        'platform-admin-auth.controller.ts',
        'issuePasswordSetupLink',
        error,
        { userId },
      );
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        'Failed to issue password setup link',
      );
    }
  }
}

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { adminAccountDisabled, invalidToken } from '../errors/error.builder.js';
import {
  AuthenticatedPlatformAdmin,
  AuthTokenType,
  verifyTokenOfType,
} from './auth-token.js';

/**
 * Guard for the SaaS side (platform admins). Kept separate from AuthGuard on
 * purpose: an admin has no shop_id, so attaching them to a shop request would
 * silently produce `shopId: null` in every downstream query.
 *
 * A platform admin token can never open an OWNER route, and vice versa —
 * see AuthTokenType.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigurationService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    const payload = await verifyTokenOfType(
      this.jwtService,
      this.configService.jwtSecret,
      request.headers.authorization,
      AuthTokenType.PLATFORM_ADMIN,
    );

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, isActive: true },
    });

    if (!admin) {
      throw new UnauthorizedException(invalidToken());
    }

    if (!admin.isActive) {
      throw new ForbiddenException(adminAccountDisabled());
    }

    const authenticatedAdmin: AuthenticatedPlatformAdmin = {
      adminId: admin.id,
      name: admin.name,
    };

    (request as Request & { user: AuthenticatedPlatformAdmin }).user =
      authenticatedAdmin;

    return true;
  }
}

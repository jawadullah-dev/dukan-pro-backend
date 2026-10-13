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
import { ShopStatus, UserStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  invalidToken,
  shopSuspended,
  userSuspended,
} from '../errors/error.builder.js';
import {
  AuthenticatedOwner,
  AuthTokenType,
  verifyTokenOfType,
} from './auth-token.js';

/**
 * Multi-tenancy contract: this guard attaches
 *   request.user = { userId, shopId, role }
 * Every downstream feature service must scope its Prisma queries by
 * request.user.shopId so one shop owner cannot see another shop's data.
 *
 * The guard re-reads the user and the shop on every request rather than
 * trusting the token alone. That costs one indexed lookup, and it is what
 * makes WF3 real: suspending a shop or a user takes effect immediately instead
 * of waiting for a 24h token to expire.
 */
@Injectable()
export class AuthGuard implements CanActivate {
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
      AuthTokenType.OWNER,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { shop: true },
    });

    if (!user) {
      throw new UnauthorizedException(invalidToken());
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(userSuspended());
    }

    if (
      user.shop.status !== ShopStatus.ACTIVE ||
      user.shop.subscriptionEndsAt.getTime() <= Date.now()
    ) {
      throw new ForbiddenException(shopSuspended());
    }

    const authenticatedUser: AuthenticatedOwner = {
      userId: user.id,
      shopId: user.shopId,
      role: user.role,
    };

    (request as Request & { user: AuthenticatedOwner }).user =
      authenticatedUser;

    return true;
  }
}

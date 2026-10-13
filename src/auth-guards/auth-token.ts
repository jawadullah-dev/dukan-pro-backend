import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../generated/prisma/enums.js';
import { invalidToken } from '../errors/error.builder.js';

/**
 * Which door the token opens.
 *
 * A platform admin is NOT a shop owner and has no `shop_id` (see
 * `platform_admins` — it deliberately lives outside the tenant tables). Both
 * identities sign with the same secret, so without this claim an admin token
 * would pass AuthGuard and every service would read `shopId: null`.
 */
export enum AuthTokenType {
  OWNER = 'OWNER',
  PLATFORM_ADMIN = 'PLATFORM_ADMIN',
}

export interface JwtPayloadClaims {
  sub: string;
  typ: AuthTokenType;
  /** Present for OWNER tokens only. */
  shopId?: string | null;
  role?: UserRole;
}

/**
 * What AuthGuard attaches to the request. Every downstream service reads
 * `request.user.shopId` — this is the multi-tenancy boundary.
 */
export interface AuthenticatedOwner {
  userId: string;
  shopId: string;
  role: UserRole;
}

export interface AuthenticatedPlatformAdmin {
  adminId: string;
  name: string;
}

/**
 * Pull the raw token out of `Authorization: Bearer <token>`.
 */
export const extractBearerToken = (header: string | undefined): string => {
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedException(invalidToken());
  }

  const token = header.slice('Bearer '.length).trim();

  if (!token) {
    throw new UnauthorizedException(invalidToken());
  }

  return token;
};

/**
 * Verify signature + expiry and assert the token was minted for `expectedType`.
 * A platform-admin token presented to a shop route is rejected here, before any
 * service runs.
 */
export const verifyTokenOfType = async (
  jwtService: JwtService,
  secret: string,
  header: string | undefined,
  expectedType: AuthTokenType,
): Promise<JwtPayloadClaims> => {
  const token = extractBearerToken(header);

  let payload: JwtPayloadClaims;

  try {
    payload = await jwtService.verifyAsync<JwtPayloadClaims>(token, {
      secret,
    });
  } catch {
    throw new UnauthorizedException(invalidToken());
  }

  if (
    !payload?.sub ||
    payload.typ !== expectedType ||
    (expectedType === AuthTokenType.OWNER && !payload.shopId)
  ) {
    throw new UnauthorizedException(invalidToken());
  }

  return payload;
};

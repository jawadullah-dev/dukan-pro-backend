import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthTokenType,
  extractBearerToken,
  verifyTokenOfType,
} from './auth-token.js';

const jwtStub = {
  verifyAsync: jest.fn(),
};

const SECRET = 'test-secret';

const ownerClaims = {
  sub: 'user-1',
  typ: AuthTokenType.OWNER,
  shopId: 'shop-1',
  role: 'OWNER',
};

describe('auth-token', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('extractBearerToken', () => {
    it('throws when the header is missing', () => {
      expect(() => extractBearerToken(undefined)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws when the scheme is not Bearer', () => {
      expect(() => extractBearerToken('Basic abc')).toThrow(
        UnauthorizedException,
      );
    });

    it('throws when the token part is empty', () => {
      expect(() => extractBearerToken('Bearer ')).toThrow(
        UnauthorizedException,
      );
    });

    it('returns the trimmed token', () => {
      expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    });
  });

  describe('verifyTokenOfType', () => {
    it('rejects a platform admin token on an OWNER route', async () => {
      jwtStub.verifyAsync.mockResolvedValue({
        sub: 'admin-1',
        typ: AuthTokenType.PLATFORM_ADMIN,
      });

      await expect(
        verifyTokenOfType(
          jwtStub as unknown as JwtService,
          SECRET,
          'Bearer x.y.z',
          AuthTokenType.OWNER,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an owner token on a platform admin route', async () => {
      jwtStub.verifyAsync.mockResolvedValue(ownerClaims);

      await expect(
        verifyTokenOfType(
          jwtStub as unknown as JwtService,
          SECRET,
          'Bearer x.y.z',
          AuthTokenType.PLATFORM_ADMIN,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an owner token that carries no shopId', async () => {
      jwtStub.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        typ: AuthTokenType.OWNER,
      });

      await expect(
        verifyTokenOfType(
          jwtStub as unknown as JwtService,
          SECRET,
          'Bearer x.y.z',
          AuthTokenType.OWNER,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an expired or tampered token', async () => {
      jwtStub.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(
        verifyTokenOfType(
          jwtStub as unknown as JwtService,
          SECRET,
          'Bearer x.y.z',
          AuthTokenType.OWNER,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns the claims for a valid owner token', async () => {
      jwtStub.verifyAsync.mockResolvedValue(ownerClaims);

      const claims = await verifyTokenOfType(
        jwtStub as unknown as JwtService,
        SECRET,
        'Bearer x.y.z',
        AuthTokenType.OWNER,
      );

      expect(claims.shopId).toBe('shop-1');
    });
  });
});

import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { hashOpaqueToken } from '../../helpers/token.helper.js';
import { ShopStatus, UserStatus } from '../../generated/prisma/enums.js';

/** bcrypt of 'DukaanOwner1' at cost 10 — the tests' "correct" password. */
const OWNER_HASH =
  '$2b$10$TYBckodBmm.qfBgbijORsOoLKI33S7xEDAZPshda1PLBjKFgHQfX2';
/** bcrypt of 'AdminOwner1' at cost 10. */
const ADMIN_HASH =
  '$2b$10$9MnQr9IbXkrvysLLt33CnuuDK61UFx1pYbLhKRU4KOFHjzsEUWTfW';

const prismaStub = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  platformAdmin: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const jwtStub = {
  signAsync: jest.fn(),
  verifyAsync: jest.fn(),
};

const configStub = {
  jwtSecret: 'test-secret',
  jwtExpiresIn: '24h',
  bcryptRounds: 10,
  passwordSetupTokenTtlMinutes: 1440,
  appBaseUrl: 'http://localhost:3000',
};

const activeShop = {
  id: 'shop-1',
  name: 'Al-Madina Mobile',
  status: ShopStatus.ACTIVE,
  subscriptionEndsAt: new Date(Date.now() + 86_400_000),
};

const activeUser = {
  id: 'user-1',
  shopId: 'shop-1',
  name: 'Ali Khan',
  phone: '923001234567',
  passwordHash: OWNER_HASH,
  passwordSetupTokenHash: null,
  passwordSetupExpiresAt: null,
  role: 'OWNER',
  status: UserStatus.ACTIVE,
  shop: activeShop,
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    jwtStub.signAsync.mockResolvedValue('signed.jwt.token');
    service = new AuthService(
      prismaStub as unknown as PrismaService,
      jwtStub as unknown as JwtService,
      configStub as unknown as AppConfigurationService,
    );
  });

  describe('ownerLogin', () => {
    it('normalises the phone before querying', async () => {
      prismaStub.user.findUnique.mockResolvedValue(null);

      await expect(
        service.ownerLogin({ phone: '0300-1234567', password: 'whatever1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prismaStub.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { phone: '923001234567' } }),
      );
    });

    it('returns the same 401 for an unknown phone and a wrong password', async () => {
      prismaStub.user.findUnique.mockResolvedValue(null);
      const unknown = await service
        .ownerLogin({ phone: '03001234567', password: 'wrongpass1' })
        .catch((e) => e.getStatus());

      prismaStub.user.findUnique.mockResolvedValue(activeUser);
      const wrongPassword = await service
        .ownerLogin({ phone: '03001234567', password: 'wrongpass1' })
        .catch((e) => e.getStatus());

      expect(unknown).toBe(401);
      expect(wrongPassword).toBe(401);
    });

    it('rejects an unrecognisable phone number without touching the db', async () => {
      await expect(
        service.ownerLogin({ phone: '12345', password: 'whatever1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prismaStub.user.findUnique).not.toHaveBeenCalled();
    });

    it('gives an account with no password yet the same generic 401', async () => {
      prismaStub.user.findUnique.mockResolvedValue({
        ...activeUser,
        passwordHash: null,
      });

      await expect(
        service.ownerLogin({ phone: '03001234567', password: 'whatever1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns 403 shopSuspended when the subscription has expired', async () => {
      prismaStub.user.findUnique.mockResolvedValue({
        ...activeUser,
        shop: {
          ...activeShop,
          subscriptionEndsAt: new Date(Date.now() - 1000),
        },
      });

      await expect(
        service.ownerLogin({ phone: '03001234567', password: 'DukaanOwner1' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('returns 403 when the shop is suspended even with a valid password', async () => {
      prismaStub.user.findUnique.mockResolvedValue({
        ...activeUser,
        shop: { ...activeShop, status: ShopStatus.SUSPENDED },
      });

      await expect(
        service.ownerLogin({ phone: '03001234567', password: 'DukaanOwner1' }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('signs an OWNER token carrying the shopId', async () => {
      prismaStub.user.findUnique.mockResolvedValue(activeUser);

      const res = await service.ownerLogin({
        phone: '03001234567',
        password: 'DukaanOwner1',
      });

      expect(jwtStub.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          typ: 'OWNER',
          shopId: 'shop-1',
        }),
        expect.objectContaining({ secret: 'test-secret' }),
      );
      expect(res.accessToken).toBe('signed.jwt.token');
      expect(res.shopId).toBe('shop-1');
    });
  });

  describe('platformAdminLogin', () => {
    it('never puts a shopId in an admin token', async () => {
      prismaStub.platformAdmin.findUnique.mockResolvedValue({
        id: 'admin-1',
        name: 'Support',
        phone: '923009999999',
        passwordHash: ADMIN_HASH,
        isActive: true,
      });

      const res = await service.platformAdminLogin({
        phone: '03009999999',
        password: 'AdminOwner1',
      });

      const [claims] = jwtStub.signAsync.mock.calls[0];
      expect(claims.typ).toBe('PLATFORM_ADMIN');
      expect(claims.shopId).toBeUndefined();
      expect(
        (res as unknown as Record<string, unknown>).shopId,
      ).toBeUndefined();
    });
  });

  describe('setupPassword', () => {
    it('rejects a malformed token before hitting the database', async () => {
      await expect(
        service.setupPassword({ token: 'not-hex', password: 'DukaanOwner1' }),
      ).rejects.toMatchObject({ status: 400 });

      expect(prismaStub.user.findFirst).not.toHaveBeenCalled();
    });

    it('clears the token so the link cannot be replayed', async () => {
      const token = 'a'.repeat(64);
      prismaStub.user.findFirst.mockResolvedValue({
        ...activeUser,
        passwordSetupTokenHash: hashOpaqueToken(token),
        passwordSetupExpiresAt: new Date(Date.now() + 60_000),
      });

      prismaStub.user.updateMany.mockResolvedValue({ count: 1 });

      await service.setupPassword({ token, password: 'DukaanOwner1' });

      expect(prismaStub.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'user-1',
            passwordSetupTokenHash: hashOpaqueToken(token),
            passwordSetupExpiresAt: { gt: expect.any(Date) },
          }),
          data: expect.objectContaining({
            passwordSetupTokenHash: null,
            passwordSetupExpiresAt: null,
          }),
        }),
      );
    });

    it('rejects an expired token', async () => {
      const token = 'b'.repeat(64);
      prismaStub.user.findFirst.mockResolvedValue({
        ...activeUser,
        passwordSetupTokenHash: hashOpaqueToken(token),
        passwordSetupExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.setupPassword({ token, password: 'DukaanOwner1' }),
      ).rejects.toMatchObject({ status: 400 });

      expect(prismaStub.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('issuePasswordSetupLink', () => {
    it('stores only a hash and returns a URL built from APP_BASE_URL', async () => {
      prismaStub.user.findUnique.mockResolvedValue(activeUser);

      const res = await service.issuePasswordSetupLink('user-1');

      const update = prismaStub.user.update.mock.calls[0][0].data;
      expect(update.passwordSetupTokenHash).toMatch(/^[a-f0-9]{64}$/);

      const tokenInUrl = new URL(res.setupUrl).searchParams.get('token');
      expect(tokenInUrl).toHaveLength(64);
      expect(
        res.setupUrl.startsWith('http://localhost:3000/setup-password?'),
      ).toBe(true);
      expect(res.setupUrl).not.toContain(update.passwordSetupTokenHash);
    });
  });

  describe('changePassword', () => {
    it('rejects when the current password is wrong and does not write', async () => {
      prismaStub.user.findUnique.mockResolvedValue(activeUser);

      await expect(
        service.changePassword('user-1', {
          currentPassword: 'WrongPass1',
          newPassword: 'DukaanOwner2',
        }),
      ).rejects.toMatchObject({ status: 400 });

      expect(prismaStub.user.update).not.toHaveBeenCalled();
    });
  });
});

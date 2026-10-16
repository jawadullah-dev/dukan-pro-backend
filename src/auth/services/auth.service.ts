import * as bcrypt from 'bcrypt';
import type { StringValue } from 'ms';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopStatus, UserStatus } from '../../generated/prisma/enums.js';
import {
  currentPasswordIncorrect,
  invalidCredentials,
  invalidSetupToken,
  resourceNotFound,
  shopSuspended,
  userSuspended,
  adminAccountDisabled,
} from '../../errors/error.builder.js';
import { normalizePhone } from '../../helpers/phone.helper.js';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  isWellFormedToken,
} from '../../helpers/token.helper.js';
import { logInfo } from '../../helpers/logger-helper.js';
import { AuthTokenType } from '../../auth-guards/auth-token.js';
import { OwnerLoginDto } from '../dto/owner-login.dto.js';
import { PlatformAdminLoginDto } from '../dto/platform-admin-login.dto.js';
import { SetupPasswordDto } from '../dto/setup-password.dto.js';
import { ChangePasswordDto } from '../dto/change-password.dto.js';
import {
  OwnerLoginResponseDto,
  PlatformAdminLoginResponseDto,
} from '../dto/login-response.dto.js';
import { PasswordSetupLinkResponseDto } from '../dto/password-setup-link-response.dto.js';
import { MeResponseDto } from '../dto/me-response.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { RegisterOwnerDto } from '../dto/register-owner.dto.js';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  WALK_IN_SUPPLIER,
} from '../../platform-admin/constants/default-lists.constant.js';
import {
  nextFreeStoreSlug,
  storeSlugBase,
} from '../../store/helpers/store-slug.helper.js';

/**
 * A real bcrypt hash of a value nobody can guess, used only to keep the
 * "user does not exist" path as slow as the "wrong password" path. Without it,
 * login is a timing oracle that tells an attacker which phone numbers are
 * registered.
 */
const TIMING_EQUALISER_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.7QGK2M4Yw1nBqzYlJ0Z7iVfZ1zUq7r2K';

const SETUP_PASSWORD_PATH = '/setup-password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: AppConfigurationService,
  ) {}

  /**
   * Self-serve shop owner registration.
   * Creates owner account + new shop + starter categories & default settings.
   */
  async registerOwner(dto: RegisterOwnerDto): Promise<OwnerLoginResponseDto> {
    const ownerPhone = normalizePhone(dto.phone);
    if (!ownerPhone) {
      throw new BadRequestException(
        'Please provide a valid Pakistani mobile number (e.g. 03001234567)',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { phone: ownerPhone },
    });
    if (existingUser) {
      throw new BadRequestException(
        'This mobile number is already registered. Please log in.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const subscriptionEndsAt = new Date();
    subscriptionEndsAt.setDate(subscriptionEndsAt.getDate() + 30);

    const shopName = dto.shopName.trim();
    const ownerName = (dto.fullName || dto.name)?.trim();
    if (!ownerName) {
      throw new BadRequestException('Full name is required');
    }

    const resolvedAddress = (dto.address || dto.shopAddress)?.trim() ?? null;
    const resolvedCity = dto.city?.trim() ?? null;

    const { shop, user } = await this.prisma.$transaction(async (tx) => {
      const newShop = await tx.shop.create({
        data: {
          name: shopName,
          phone: dto.shopPhone
            ? normalizePhone(dto.shopPhone) ?? dto.shopPhone
            : ownerPhone,
          address: resolvedAddress,
          status: ShopStatus.ACTIVE,
          subscriptionEndsAt,
        },
      });

      const newUser = await tx.user.create({
        data: {
          shopId: newShop.id,
          name: ownerName,
          phone: ownerPhone,
          passwordHash,
          role: 'OWNER',
          status: UserStatus.ACTIVE,
        },
      });

      if (DEFAULT_CATEGORIES.length > 0) {
        await tx.category.createMany({
          data: DEFAULT_CATEGORIES.map((name) => ({
            shopId: newShop.id,
            name,
          })),
        });
      }

      if (DEFAULT_EXPENSE_CATEGORIES.length > 0) {
        await tx.expenseCategory.createMany({
          data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
            shopId: newShop.id,
            name,
          })),
        });
      }

      await tx.supplier.create({
        data: {
          shopId: newShop.id,
          name: WALK_IN_SUPPLIER.name,
          notes: WALK_IN_SUPPLIER.notes,
          isSystem: WALK_IN_SUPPLIER.isSystem,
        },
      });

      const storeSlug = await nextFreeStoreSlug(
        storeSlugBase(newShop.name, newShop.id),
        async (candidate) =>
          Boolean(
            await tx.shopStoreSettings.findUnique({
              where: { slug: candidate },
              select: { slug: true },
            }),
          ),
      );

      await tx.shopStoreSettings.create({
        data: {
          shopId: newShop.id,
          slug: storeSlug,
          isEnabled: true,
          displayName: newShop.name.trim().slice(0, 100),
          phoneNumber: newShop.phone,
          address: resolvedAddress,
          city: resolvedCity,
        },
      });

      return { shop: newShop, user: newUser };
    });

    logInfo(
      'auth.service.ts',
      'registerOwner',
      `Owner "${ownerName}" registered with shop "${shopName}"`,
    );

    const accessToken = await this.signToken({
      sub: user.id,
      typ: AuthTokenType.OWNER,
      shopId: user.shopId,
      role: user.role,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.jwtExpiresIn,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      shopId: user.shopId,
      shop: {
        name: shop.name,
        subscriptionEndsAt: shop.subscriptionEndsAt,
      },
    };
  }

  /**
   * WF2 — owner login. Phone + password, then JWT carrying shopId.
   *
   * Two separate rejections on purpose:
   *  - suspended / expired shop -> 403 shopSuspended, so the owner sees
   *    "your subscription ended" instead of a generic auth error (WF3).
   *  - wrong phone or password -> 401 with one identical message for both, so
   *    the endpoint cannot be used to discover which phones exist.
   */
  async ownerLogin(dto: OwnerLoginDto): Promise<OwnerLoginResponseDto> {
    const phone = normalizePhone(dto.phone);

    if (!phone) {
      throw new UnauthorizedException(invalidCredentials());
    }

    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { shop: true },
    });

    if (!user) {
      await bcrypt.compare(dto.password, TIMING_EQUALISER_HASH);
      throw new UnauthorizedException(invalidCredentials());
    }

    if (!user.passwordHash) {
      // WF2: an un-setup account must not answer differently from an
      // unknown phone — otherwise login is an account-enumeration oracle.
      // Consume the timing equaliser so this path costs one bcrypt compare
      // like every other rejection, then give the same generic 401.
      await bcrypt.compare(dto.password, TIMING_EQUALISER_HASH);
      throw new UnauthorizedException(invalidCredentials());
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException(invalidCredentials());
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

    const accessToken = await this.signToken({
      sub: user.id,
      typ: AuthTokenType.OWNER,
      shopId: user.shopId,
      role: user.role,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.jwtExpiresIn,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      shopId: user.shopId,
      shop: {
        name: user.shop.name,
        subscriptionEndsAt: user.shop.subscriptionEndsAt,
      },
    };
  }

  /**
   * WF1 step 2 — SaaS admin login. Separate from owner login because
   * `platform_admins` has no shop_id (CLAUDE.md section 7).
   */
  async platformAdminLogin(
    dto: PlatformAdminLoginDto,
  ): Promise<PlatformAdminLoginResponseDto> {
    const phone = normalizePhone(dto.phone);

    if (!phone) {
      throw new UnauthorizedException(invalidCredentials());
    }

    const admin = await this.prisma.platformAdmin.findUnique({
      where: { phone },
    });

    if (!admin) {
      await bcrypt.compare(dto.password, TIMING_EQUALISER_HASH);
      throw new UnauthorizedException(invalidCredentials());
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      admin.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException(invalidCredentials());
    }

    if (!admin.isActive) {
      throw new ForbiddenException(adminAccountDisabled());
    }

    const accessToken = await this.signToken({
      sub: admin.id,
      typ: AuthTokenType.PLATFORM_ADMIN,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.configService.jwtExpiresIn,
      admin: { id: admin.id, name: admin.name, phone: admin.phone },
    };
  }

  /**
   * WF1 step 3 / password reset — mint a one-time setup link for an owner.
   *
   * Dukaan Pro deliberately sends no email and no SMS. The admin copies the URL
   * from this response and forwards it to the owner on WhatsApp, which is how
   * the target user actually communicates.
   *
   * Issuing a link also resets the password, so this is both the first-setup
   * and the "I forgot my password" path — there is no separate reset endpoint
   * because there would be no way to deliver it.
   *
   * Issuing again invalidates the previous link: only one token is ever live.
   */
  async issuePasswordSetupLink(
    userId: string,
  ): Promise<PasswordSetupLinkResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(resourceNotFound('User', userId));
    }

    const replacedPreviousLink = Boolean(
      user.passwordSetupTokenHash &&
      user.passwordSetupExpiresAt &&
      user.passwordSetupExpiresAt.getTime() > Date.now(),
    );
    const link = await this.buildSetupLink(user.id);

    logInfo(
      'auth.service.ts',
      'issuePasswordSetupLink',
      `Password setup link issued for ${user.phone}, valid until ${link.expiresAt.toISOString()}`,
      {
        userId,
        shopId: user.shopId,
        // Not the setupUrl: it embeds the plaintext token, so logging it would
        // hand account takeover to anyone who can read the logs.
        expiresAt: link.expiresAt.toISOString(),
      },
    );

    return {
      userId: user.id,
      userName: user.name,
      userPhone: user.phone,
      expiresAt: link.expiresAt,
      setupUrl: link.setupUrl,
      replacedPreviousLink,
    };
  }

  /**
   * Mint a setup token for a user that already exists.
   *
   * Split out from issuePasswordSetupLink so shop onboarding can call it with
   * its own transaction client — the user row is created inside that
   * transaction, so it is not visible to the main Prisma client yet and
   * issuePasswordSetupLink could not find it.
   */
  async buildSetupLink(
    userId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ setupUrl: string; expiresAt: Date }> {
    const token = generateOpaqueToken();
    const tokenHash = hashOpaqueToken(token);
    const expiresAt = new Date(
      Date.now() + this.configService.passwordSetupTokenTtlMinutes * 60_000,
    );

    await client.user.update({
      where: { id: userId },
      data: {
        passwordSetupTokenHash: tokenHash,
        passwordSetupExpiresAt: expiresAt,
      },
    });

    const setupUrl = `${this.configService.appBaseUrl}${SETUP_PASSWORD_PATH}?token=${token}`;

    return { setupUrl, expiresAt };
  }

  /**
   * Consume a setup link. The token is single use: the hash is cleared in the
   * same update that stores the password, so a replayed link fails.
   */
  async setupPassword(dto: SetupPasswordDto): Promise<StatusBaseResponseDTO> {
    if (!isWellFormedToken(dto.token)) {
      throw new BadRequestException(invalidSetupToken());
    }

    const tokenHash = hashOpaqueToken(dto.token);

    const user = await this.prisma.user.findFirst({
      where: { passwordSetupTokenHash: tokenHash },
    });

    if (!user || !user.passwordSetupExpiresAt) {
      throw new BadRequestException(invalidSetupToken());
    }

    if (user.passwordSetupExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(invalidSetupToken());
    }

    const passwordHash = await bcrypt.hash(
      dto.password,
      this.configService.bcryptRounds,
    );

    const consumed = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        passwordSetupTokenHash: tokenHash,
        passwordSetupExpiresAt: { gt: new Date() },
      },
      data: {
        passwordHash,
        passwordSetupTokenHash: null,
        passwordSetupExpiresAt: null,
      },
    });

    if (consumed.count !== 1) {
      throw new BadRequestException(invalidSetupToken());
    }

    logInfo(
      'auth.service.ts',
      'setupPassword',
      `Password set for user ${user.phone}`,
      { userId: user.id, shopId: user.shopId },
    );

    return new StatusBaseResponseDTO(true, 'Password set successfully');
  }

  /**
   * Owner changes their own password. Requires the current one so a stolen
   * token alone cannot lock the real owner out.
   *
   * Existing access tokens keep working until they expire (up to 24h). There is
   * no refresh-token table to revoke against — see the token strategy note in
   * CLAUDE.md if that becomes a problem.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<StatusBaseResponseDTO> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user?.passwordHash) {
      throw new NotFoundException(resourceNotFound('User', userId));
    }

    const passwordMatches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new BadRequestException(currentPasswordIncorrect());
    }

    const passwordHash = await bcrypt.hash(
      dto.newPassword,
      this.configService.bcryptRounds,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return new StatusBaseResponseDTO(true, 'Password changed successfully');
  }

  /**
   * GET /auth/me — the PWA calls this on cold start to decide whether to show
   * the app or the "subscription ended" screen.
   */
  async getMe(userId: string): Promise<MeResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { shop: true },
    });

    if (!user) {
      throw new NotFoundException(resourceNotFound('User', userId));
    }

    return {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      shop: {
        id: user.shop.id,
        name: user.shop.name,
        shopStatus: user.shop.status,
        subscriptionEndsAt: user.shop.subscriptionEndsAt,
      },
    };
  }

  private async signToken(claims: {
    sub: string;
    typ: AuthTokenType;
    shopId?: string;
    role?: string;
  }): Promise<string> {
    // The module-level signOptions already carry the secret and expiry from the
    // same config, but they are repeated here so this call is correct even if
    // the service is instantiated outside the global JwtModule (tests, future
    // non-default contexts).
    return this.jwtService.signAsync(claims, {
      secret: this.configService.jwtSecret,
      expiresIn: this.configService.jwtExpiresIn as StringValue,
    });
  }
}

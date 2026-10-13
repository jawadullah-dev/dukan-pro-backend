import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ShopStatus } from '../../generated/prisma/enums.js';
import { AuthService } from '../../auth/services/auth.service.js';
import {
  normalizePhone,
  normalizePhoneOrRaw,
} from '../../helpers/phone.helper.js';
import { isUniqueConstraintViolation } from '../../helpers/prisma-error-helper.js';
import { logInfo } from '../../helpers/logger-helper.js';
import {
  oneOwnerPerShop,
  invalidOwnerPhone,
  ownerPhoneAlreadyRegistered,
  resourceNotFound,
  invalidSubscriptionDate,
  subscriptionEndInPast,
} from '../../errors/error.builder.js';
import {
  DEFAULT_BRANDS,
  DEFAULT_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  WALK_IN_SUPPLIER,
} from '../constants/default-lists.constant.js';
import { CreateShopDto } from '../dto/create-shop.dto.js';
import { CreateShopResponseDto } from '../dto/create-shop-response.dto.js';
import { UpdateSubscriptionDto } from '../dto/update-subscription.dto.js';
import { UpdateSubscriptionResponseDto } from '../dto/update-subscription-response.dto.js';
import { ShopOwnerStatusResponseDto } from '../dto/shop-owner-status-response.dto.js';
import { ChangeStoreSlugDto } from '../dto/change-store-slug.dto.js';
import { StoreService } from '../../store/services/store.service.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import {
  storeSlugBase,
  nextFreeStoreSlug,
} from '../../store/helpers/store-slug.helper.js';

/**
 * The SaaS side of the product: creating shops (WF1) and managing their
 * subscription (WF3). No shop_id filter applies here — a platform admin is
 * outside the tenant system and legitimately operates across all shops.
 */
@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly storeService: StoreService,
  ) {}

  /**
   * WF1 — onboard a shop in one call.
   *
   * Everything happens in ONE transaction: shop, owner, the copied default
   * lists, the Walk-in seller supplier, and the owner's setup token. A shop
   * without an owner is an unusable tenant nobody can log into, and a shop
   * without its defaults has no categories to file a product under. Half an
   * onboarding is worse than none, so it is all-or-nothing.
   *
   * Opening cash and old Udhar are deliberately NOT part of this call — those
   * write to the append-only cash ledger, and the owner enters them himself in
   * WF1 step 5, once he can see his own shop.
   */
  async createShop(dto: CreateShopDto): Promise<CreateShopResponseDto> {
    const ownerPhone = normalizePhone(dto.ownerPhone);

    if (!ownerPhone) {
      // Not the same problem as "already taken" — the owner can never log in
      // with a number we cannot normalise, so name the real fault.
      throw new BadRequestException(invalidOwnerPhone(dto.ownerPhone.trim()));
    }

    const subscriptionEndsAt = new Date(dto.subscriptionEndsAt);

    if (Number.isNaN(subscriptionEndsAt.getTime())) {
      throw new BadRequestException(invalidSubscriptionDate());
    }

    if (subscriptionEndsAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        subscriptionEndInPast(dto.subscriptionEndsAt),
      );
    }

    // Cheap pre-check for a friendly message. The unique index on users.phone is
    // still the real guarantee — see the P2002 catch below, which is what
    // actually protects against two admins creating a shop at the same moment.
    const existingOwner = await this.prisma.user.findUnique({
      where: { phone: ownerPhone },
      select: { shop: { select: { name: true } } },
    });

    if (existingOwner) {
      throw new BadRequestException(
        ownerPhoneAlreadyRegistered(dto.ownerPhone.trim()),
      );
    }

    const shopName = dto.shopName.trim();
    const ownerName = dto.ownerName.trim();

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const shop = await tx.shop.create({
          data: {
            name: shopName,
            phone: dto.shopPhone ? normalizePhoneOrRaw(dto.shopPhone) : null,
            address: dto.shopAddress?.trim() ?? null,
            status: ShopStatus.ACTIVE,
            subscriptionEndsAt,
          },
        });

        const owner = await tx.user.create({
          data: {
            shopId: shop.id,
            name: ownerName,
            phone: ownerPhone,
            // No password yet — the owner chooses it via the setup link, so the
            // admin never handles it (WF1 step 4: "The admin never sees the
            // password").
            passwordHash: null,
            role: 'OWNER',
          },
        });

        // Copies, not shared rows. See default-lists.constant.ts.
        if (DEFAULT_CATEGORIES.length > 0) {
          await tx.category.createMany({
            data: DEFAULT_CATEGORIES.map((name) => ({ shopId: shop.id, name })),
          });
        }

        if (DEFAULT_BRANDS.length > 0) {
          await tx.brand.createMany({
            data: DEFAULT_BRANDS.map((name) => ({ shopId: shop.id, name })),
          });
        }

        if (DEFAULT_EXPENSE_CATEGORIES.length > 0) {
          await tx.expenseCategory.createMany({
            data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
              shopId: shop.id,
              name,
            })),
          });
        }

        await tx.supplier.create({
          data: {
            shopId: shop.id,
            name: WALK_IN_SUPPLIER.name,
            notes: WALK_IN_SUPPLIER.notes,
            isSystem: WALK_IN_SUPPLIER.isSystem,
          },
        });

        // WF19 step 1 — the store row is born with the shop: OFF by default,
        // a free address derived exactly like the R1.2 backfill (shared
        // helper), so the owner's first visit to Store settings finds a link
        // instead of a 404.
        const storeSlug = await nextFreeStoreSlug(
          storeSlugBase(shop.name, shop.id),
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
            shopId: shop.id,
            slug: storeSlug,
            isEnabled: false,
            displayName: shop.name.trim().slice(0, 100),
            phoneNumber: shop.phone,
            address: shop.address,
          },
        });

        // Issued through AuthService so onboarding and the standalone
        // reissue endpoint can never drift apart on token rules or hashing.
        const link = await this.authService.buildSetupLink(owner.id, tx);

        return { shop, owner, link };
      });

      logInfo(
        'platform-admin.service.ts',
        'createShop',
        `Shop "${shopName}" onboarded with owner ${ownerPhone}`,
        {
          shopId: result.shop.id,
          ownerId: result.owner.id,
          subscriptionEndsAt: subscriptionEndsAt.toISOString(),
          setupLinkExpiresAt: result.link.expiresAt.toISOString(),
          // Deliberately NOT the setupUrl: it carries the plaintext token, and
          // anyone reading the log could take over the owner's account.
        },
      );

      return {
        shopId: result.shop.id,
        shopName: result.shop.name,
        ownerId: result.owner.id,
        ownerName: result.owner.name,
        ownerPhone: result.owner.phone,
        setupUrl: result.link.setupUrl,
        setupLinkExpiresAt: result.link.expiresAt,
        defaults: {
          categories: DEFAULT_CATEGORIES.length,
          brands: DEFAULT_BRANDS.length,
          expenseCategories: DEFAULT_EXPENSE_CATEGORIES.length,
          suppliers: 1,
        },
        counters: {
          nextSaleNo: result.shop.nextSaleNo,
          nextPurchaseNo: result.shop.nextPurchaseNo,
        },
        status: result.shop.status,
      };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new BadRequestException(
          ownerPhoneAlreadyRegistered(dto.ownerPhone.trim()),
        );
      }
      throw error;
    }
  }

  /**
   * WF3 — renew a subscription or suspend a shop.
   *
   * The guard already blocks requests from a suspended or expired shop, so
   * suspending takes effect immediately rather than when the owner's 24h token
   * happens to expire. Extending the subscription date reactivates the shop
   * unless the admin explicitly sends isActive: false.
   */
  async updateSubscription(
    shopId: string,
    dto: UpdateSubscriptionDto,
  ): Promise<UpdateSubscriptionResponseDto> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });

    if (!shop) {
      throw new NotFoundException(resourceNotFound('Shop', shopId));
    }

    if (dto.subscriptionEndsAt === undefined && dto.isActive === undefined) {
      throw new BadRequestException(
        'Nothing to update. Send subscriptionEndsAt to renew, or isActive to suspend / reactivate.',
      );
    }

    const data: {
      subscriptionEndsAt?: Date;
      status?: ShopStatus;
    } = {};

    if (dto.subscriptionEndsAt !== undefined) {
      const endsAt = new Date(dto.subscriptionEndsAt);

      if (Number.isNaN(endsAt.getTime())) {
        throw new BadRequestException(invalidSubscriptionDate());
      }

      if (endsAt.getTime() <= Date.now()) {
        // Renewing to a date that has already passed would leave the shop
        // looking renewed in the admin UI while login still fails.
        throw new BadRequestException(
          subscriptionEndInPast(dto.subscriptionEndsAt),
        );
      }

      data.subscriptionEndsAt = endsAt;
      // Workflow 3 renews by extending the date and setting the shop ACTIVE.
      // A caller can still explicitly keep it suspended with isActive: false.
      data.status =
        dto.isActive === false ? ShopStatus.SUSPENDED : ShopStatus.ACTIVE;
    }

    if (dto.isActive !== undefined && dto.subscriptionEndsAt === undefined) {
      data.status = dto.isActive ? ShopStatus.ACTIVE : ShopStatus.SUSPENDED;
    }

    const updated = await this.prisma.shop.update({
      where: { id: shopId },
      data,
    });

    logInfo(
      'platform-admin.service.ts',
      'updateSubscription',
      `Subscription updated for shop "${updated.name}"`,
      {
        shopId: updated.id,
        status: updated.status,
        subscriptionEndsAt: updated.subscriptionEndsAt.toISOString(),
      },
    );

    return {
      shopId: updated.id,
      shopName: updated.name,
      status: updated.status,
      subscriptionEndsAt: updated.subscriptionEndsAt,
      isAccessible:
        updated.status === ShopStatus.ACTIVE &&
        updated.subscriptionEndsAt.getTime() > Date.now(),
    };
  }

  /**
   * WF19 step 2 — the store address can only be renamed from here; the
   * owner's PATCH /store/settings has no slug field at all. All validation
   * (format, reserved words, uniqueness) and the public cache invalidation
   * live in StoreService so both entry points can never drift apart.
   */
  async changeStoreSlug(
    shopId: string,
    dto: ChangeStoreSlugDto,
  ): Promise<StatusBaseResponseDTO> {
    return this.storeService.changeStoreSlug(shopId, dto.slug);
  }

  /**
   * One owner per shop in the MVP (workflows PDF: "One owner per shop in the
   * MVP"). Read-only — creating a second owner is not offered yet, but the
   * admin panel needs to know whether this shop is already onboarded.
   */
  async getShopOwner(shopId: string): Promise<ShopOwnerStatusResponseDto> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        users: {
          select: {
            name: true,
            phone: true,
            passwordHash: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!shop) {
      throw new NotFoundException(resourceNotFound('Shop', shopId));
    }

    // createShop always makes exactly one owner, so more than one means the
    // shop was tampered with directly in SQL. Surface it rather than silently
    // picking one and hiding the duplicate.
    if (shop.users.length > 1) {
      throw new BadRequestException(oneOwnerPerShop(shop.name));
    }

    const owner = shop.users[0];

    return {
      shopId: shop.id,
      hasOwner: Boolean(owner),
      ownerName: owner?.name ?? null,
      ownerPhone: owner?.phone ?? null,
      hasPassword: Boolean(owner?.passwordHash),
    };
  }

  /**
   * Suspending a shop must be reversible without losing data, so this is a
   * status flip rather than a delete — nothing in this table is ever removed
   * (CLAUDE.md Rule 3).
   */
  async setShopActive(
    shopId: string,
    isActive: boolean,
  ): Promise<UpdateSubscriptionResponseDto> {
    return this.updateSubscription(shopId, { isActive });
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ShopStatus } from '../../generated/prisma/enums.js';
import {
  ResponseStoreDto,
  ResponseStoreProductDto,
  ResponseStoreCategoriesDto,
  StoreFilterOptionDto,
  StoreAvailability,
} from '../dto/response-storefront.dto.js';
import { StoreProductsQueryDto } from '../dto/store-products-query.dto.js';
import { StoreCacheService } from './store-cache.service.js';
import {
  resourceNotFound,
  storeNotAvailable,
} from '../../errors/error.builder.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';

/** Only IN_STOCK phones can be sold or counted as available. */
const SELLABLE_STATUS = 'IN_STOCK';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StorefrontProductRow = Prisma.ProductGetPayload<{
  include: {
    category: { select: { id: true; name: true } };
    brand: { select: { id: true; name: true } };
    stockLevel: { select: { quantityOnHand: true } };
    _count: {
      select: { inventoryUnits: { where: { status: typeof SELLABLE_STATUS } } };
    };
    images: { select: { url: true; sortOrder: true } };
  };
}>;

/** Everything a public product row needs, in one query. */
const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true } },
  stockLevel: { select: { quantityOnHand: true } },
  _count: {
    select: { inventoryUnits: { where: { status: SELLABLE_STATUS } } },
  },
  images: {
    select: { url: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

/** Pick one of the three public stock labels from the real number on hand. */
function availability(
  quantityOnHand: number,
  lowStockThreshold: number,
): StoreAvailability {
  if (quantityOnHand <= 0) return 'OUT_OF_STOCK';
  if (quantityOnHand <= lowStockThreshold) return 'LOW_STOCK';
  return 'IN_STOCK';
}

/**
 * The PUBLIC storefront (WF22): read-only, unauthenticated, addressed by
 * slug, and an explicit allowlist — purchases, suppliers, sales, customers,
 * cash, users, cost, IMEI and SKU are never read here.
 *
 * The owner preview routes reuse the same builders so what he sees while the
 * store is OFF is byte-for-byte what customers will get once it is ON.
 */
@Injectable()
export class StorefrontService {
  private readonly logger = new Logger(StorefrontService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: StoreCacheService,
  ) {}

  // -------------------------------------------------------------------------
  // Public routes — by slug (no login)
  // -------------------------------------------------------------------------

  /** GET /public/stores/:slug — the public profile (allowlist). */
  async getStore(slug: string): Promise<ResponseStoreDto> {
    const settings = await this.resolvePublicStore(slug);
    return this.toProfile(settings);
  }

  /** GET /public/stores/:slug/categories — filter chips for the store. */
  async getCategories(slug: string): Promise<ResponseStoreCategoriesDto> {
    const settings = await this.resolvePublicStore(slug);
    return this.buildCategories(settings.shopId);
  }

  /** GET /public/stores/:slug/products — one page of the catalog. */
  async getProducts(
    slug: string,
    query: StoreProductsQueryDto,
  ): Promise<PaginatedResponseDTO<ResponseStoreProductDto>> {
    const settings = await this.resolvePublicStore(slug);
    return this.buildProducts(settings, query);
  }

  /** GET /public/stores/:slug/products/:productId — one product. 404 otherwise. */
  async getProduct(
    slug: string,
    productId: string,
  ): Promise<ResponseStoreProductDto> {
    const settings = await this.resolvePublicStore(slug);
    return this.buildProduct(settings, productId);
  }

  // -------------------------------------------------------------------------
  // Owner preview routes — by shopId, work while the store is OFF
  // -------------------------------------------------------------------------

  async getPreviewStore(shopId: string): Promise<ResponseStoreDto> {
    const settings = await this.resolvePreviewStore(shopId);
    return this.toProfile(settings);
  }

  async getPreviewCategories(
    shopId: string,
  ): Promise<ResponseStoreCategoriesDto> {
    await this.resolvePreviewStore(shopId);
    return this.buildCategories(shopId);
  }

  async getPreviewProducts(
    shopId: string,
    query: StoreProductsQueryDto,
  ): Promise<PaginatedResponseDTO<ResponseStoreProductDto>> {
    const settings = await this.resolvePreviewStore(shopId);
    return this.buildProducts(settings, query);
  }

  async getPreviewProduct(
    shopId: string,
    productId: string,
  ): Promise<ResponseStoreProductDto> {
    const settings = await this.resolvePreviewStore(shopId);
    return this.buildProduct(settings, productId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * WF22 step 3 — missing slug, store OFF and shop SUSPENDED all fail with
   * the SAME error body, so nobody can tell the cases apart. The slug → row
   * lookup is cached ~60s (step 2); shops.status is read fresh every time.
   */
  private async resolvePublicStore(slug: string) {
    let settings = this.cache.get(slug);
    if (!settings) {
      settings =
        (await this.prisma.shopStoreSettings.findUnique({ where: { slug } })) ??
        undefined;
      if (settings) this.cache.set(slug, settings);
    }
    if (!settings || !settings.isEnabled) {
      throw new NotFoundException(storeNotAvailable());
    }

    const shop = await this.prisma.shop.findUnique({
      where: { id: settings.shopId },
      select: { status: true },
    });
    if (!shop || shop.status !== ShopStatus.ACTIVE) {
      throw new NotFoundException(storeNotAvailable());
    }
    return settings;
  }

  private async resolvePreviewStore(shopId: string) {
    const settings = await this.prisma.shopStoreSettings.findUnique({
      where: { shopId },
    });
    if (!settings) {
      throw new NotFoundException(resourceNotFound('Store settings'));
    }
    return settings;
  }

  private toProfile(settings: {
    slug: string;
    displayName: string;
    about: string | null;
    logoUrl: string | null;
    bannerUrl: string | null;
    whatsappNumber: string | null;
    phoneNumber: string | null;
    address: string | null;
    city: string | null;
    googleMapsUrl: string | null;
    openingHours: string | null;
    facebookUrl: string | null;
    instagramUrl: string | null;
  }): ResponseStoreDto {
    return {
      slug: settings.slug,
      displayName: settings.displayName,
      about: settings.about,
      logoUrl: settings.logoUrl,
      bannerUrl: settings.bannerUrl,
      whatsappNumber: settings.whatsappNumber,
      phoneNumber: settings.phoneNumber,
      address: settings.address,
      city: settings.city,
      googleMapsUrl: settings.googleMapsUrl,
      openingHours: settings.openingHours,
      facebookUrl: settings.facebookUrl,
      instagramUrl: settings.instagramUrl,
    };
  }

  /**
   * The catalog WHERE clause: published + active for this shop, narrowed by
   * the optional filters. Kept in one place so the list, the count and the
   * categories endpoint can never drift apart.
   */
  private catalogWhere(
    shopId: string,
    query?: Pick<StoreProductsQueryDto, 'q' | 'category' | 'brand'>,
  ): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {
      shopId,
      isActive: true,
      isPublished: true,
      publishedAt: { not: null },
    };
    if (query?.q) {
      where.name = { contains: query.q, mode: 'insensitive' };
    }
    if (query?.category) {
      where.category = UUID_RE.test(query.category)
        ? { id: query.category }
        : { name: { equals: query.category, mode: 'insensitive' } };
    }
    if (query?.brand) {
      where.brand = UUID_RE.test(query.brand)
        ? { id: query.brand }
        : { name: { equals: query.brand, mode: 'insensitive' } };
    }
    return where;
  }

  private async buildProducts(
    settings: { shopId: string; showExactStock: boolean },
    query: StoreProductsQueryDto,
  ): Promise<PaginatedResponseDTO<ResponseStoreProductDto>> {
    const { page, pageSize } = normalizePagination(query.page, query.limit, 50);
    const where = this.catalogWhere(settings.shopId, query);

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        include: PRODUCT_INCLUDE,
      }),
      this.prisma.product.count({ where }),
    ]);

    const items = rows.map((row: StorefrontProductRow) =>
      this.toProduct(row, settings.showExactStock),
    );
    return new PaginatedResponseDTO(items, total, page, pageSize);
  }

  private async buildProduct(
    settings: { shopId: string; showExactStock: boolean },
    productId: string,
  ): Promise<ResponseStoreProductDto> {
    const row = await this.prisma.product.findFirst({
      // Cross-shop, unpublished and inactive all answer the same 404.
      where: { ...this.catalogWhere(settings.shopId), id: productId },
      include: PRODUCT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(resourceNotFound('Product', productId));
    }
    return this.toProduct(row, settings.showExactStock);
  }

  private async buildCategories(
    shopId: string,
  ): Promise<ResponseStoreCategoriesDto> {
    const where = this.catalogWhere(shopId);
    const [categoryRows, brandRows] = await Promise.all([
      this.prisma.product.findMany({
        where,
        distinct: ['categoryId'],
        select: { category: { select: { id: true, name: true } } },
      }),
      this.prisma.product.findMany({
        where,
        distinct: ['brandId'],
        select: { brand: { select: { id: true, name: true } } },
      }),
    ]);

    const byName = (a: StoreFilterOptionDto, b: StoreFilterOptionDto): number =>
      a.name.localeCompare(b.name);

    const categories = categoryRows.map((r) => r.category).sort(byName);
    const brands = brandRows.map((r) => r.brand).sort(byName);
    return { categories, brands };
  }

  /** The only place a product becomes a public response. */
  private toProduct(
    row: StorefrontProductRow,
    showExactStock: boolean,
  ): ResponseStoreProductDto {
    const quantityOnHand =
      row.trackingType === 'QUANTITY'
        ? (row.stockLevel?.quantityOnHand ?? 0)
        : row._count.inventoryUnits;

    return {
      id: row.id,
      name: row.name,
      brand: row.brand.name,
      category: row.category.name,
      price: row.contactForPrice ? null : Number(row.defaultSellingPrice),
      contactForPrice: row.contactForPrice,
      availability: availability(quantityOnHand, row.lowStockThreshold),
      stockCount: showExactStock ? quantityOnHand : null,
      ptaStatus: row.ptaStatus,
      images: [...row.images]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((image) => image.url),
      description: row.publicDescription,
      specs: {
        model: row.model ?? null,
        color: row.color ?? null,
        ram: row.ram ?? null,
        storage: row.storage ?? null,
      },
    };
  }
}

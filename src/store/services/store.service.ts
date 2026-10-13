import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UpdateStoreSettingsDto } from '../dto/update-store-settings.dto.js';
import { ReorderProductImagesDto } from '../dto/reorder-product-images.dto.js';
import { ResponseProductImageDto } from '../dto/response-product-image.dto.js';
import type { UploadedImageFile } from '../dto/uploaded-image-file.type.js';
import { ResponseStoreSettingsDto } from '../dto/response-store-settings.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { StoreCacheService } from './store-cache.service.js';
import { R2StorageService } from './r2-storage.service.js';
import {
  resourceNotFound,
  duplicateFieldValue,
  requiredFieldCannotBeNull,
  slugReserved,
  productNotPublishable,
  imageLimitExceeded,
  reorderImageMismatch,
  unsupportedImageType,
} from '../../errors/error.builder.js';
import {
  isUniqueConstraintViolation,
  violatedColumn,
} from '../../helpers/prisma-error-helper.js';
import {
  RESERVED_SLUGS,
  storeSlugBase,
  nextFreeStoreSlug,
} from '../helpers/store-slug.helper.js';

/** Max photos per product — enforced here because the DB has no count cap. */
const MAX_PRODUCT_IMAGES = 5;
/** Longest side a processed photo may have (WF21 "about 1600 px wide"). */
const MAX_IMAGE_EDGE = 1600;
const SUPPORTED_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp']);

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: StoreCacheService,
    private readonly r2: R2StorageService,
  ) {}

  async getSettings(shopId: string): Promise<ResponseStoreSettingsDto> {
    const settings = await this.prisma.shopStoreSettings.findUnique({
      where: { shopId },
    });
    if (!settings) {
      throw new NotFoundException(resourceNotFound('Store settings'));
    }
    return settings;
  }

  async updateSettings(
    dto: UpdateStoreSettingsDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    // @IsOptional() lets `null` through — the non-nullable columns refuse it.
    if (dto.displayName === null) {
      throw new BadRequestException(
        requiredFieldCannotBeNull('Store settings', 'displayName'),
      );
    }

    const existing = await this.prisma.shopStoreSettings.findUnique({
      where: { shopId },
    });

    // When creating, derive the slug — the owner never supplies one (WF19).
    let createSlug: string | undefined;
    try {
      if (existing) {
        await this.prisma.shopStoreSettings.update({
          where: { shopId },
          data: this.buildUpdate(dto),
        });
      } else {
        // No settings row yet — first PATCH creates one. The slug comes from
        // the same derivation the DB backfill uses.
        createSlug = await this.nextFreeSlug(shopId);
        await this.prisma.shopStoreSettings.create({
          data: {
            shopId,
            slug: createSlug,
            displayName:
              dto.displayName ?? (await this.shopDisplayName(shopId)),
            isEnabled: dto.isEnabled ?? false,
            showExactStock: dto.showExactStock ?? false,
            ...this.buildUpdate(dto),
          },
        });
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error) && violatedColumn(error, 'slug')) {
        throw new BadRequestException(
          duplicateFieldValue('Store', 'slug', createSlug ?? ''),
        );
      }
      throw error;
    }

    // Any settings write invalidates the public slug cache — an OFF switch
    // must hide the store from the very next request (WF19 step 8).
    this.cache.clear();

    const verb = existing ? 'updated' : 'created';
    let message = `Store ${verb} successfully`;
    if (dto.isEnabled === true) {
      message += await this.enableWarningSuffix(dto, existing, shopId);
    }
    return new StatusBaseResponseDTO(true, message);
  }

  /**
   * WF19 step 6 — turning the store ON with nobody to message or nothing to
   * see deserves a nudge. Mutations return { status, message } only, so the
   * warning rides in the success message.
   */
  private async enableWarningSuffix(
    dto: UpdateStoreSettingsDto,
    existing: { whatsappNumber: string | null } | null,
    shopId: string,
  ): Promise<string> {
    const warnings: string[] = [];

    const whatsapp =
      dto.whatsappNumber !== undefined
        ? dto.whatsappNumber?.trim() || null
        : (existing?.whatsappNumber ?? null);
    if (!whatsapp) warnings.push('no WhatsApp number is set');

    const published = await this.prisma.product.count({
      where: {
        shopId,
        isActive: true,
        isPublished: true,
        publishedAt: { not: null },
      },
    });
    if (published === 0) warnings.push('no product is published yet');

    if (warnings.length === 0) return '';
    return `. Warning: ${warnings.join('; ')}.`;
  }

  /**
   * WF19 step 2 — only a platform admin may change the store address, via
   * PATCH /platform-admin/shops/{id}/store-slug. Shared links and QR codes
   * break on a rename, which is exactly why the owner cannot do it himself.
   */
  async changeStoreSlug(
    shopId: string,
    slug: string,
  ): Promise<StatusBaseResponseDTO> {
    const normalized = slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(normalized)) {
      throw new BadRequestException(slugReserved(normalized));
    }

    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { id: true },
    });
    if (!shop) {
      throw new NotFoundException(resourceNotFound('Shop', shopId));
    }
    const settings = await this.prisma.shopStoreSettings.findUnique({
      where: { shopId },
      select: { slug: true },
    });
    if (!settings) {
      throw new NotFoundException(resourceNotFound('Store settings'));
    }
    if (settings.slug === normalized) {
      return new StatusBaseResponseDTO(
        true,
        `Store slug updated to "${normalized}"`,
      );
    }

    try {
      await this.prisma.shopStoreSettings.update({
        where: { shopId },
        data: { slug: normalized },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error) && violatedColumn(error, 'slug')) {
        throw new BadRequestException(
          duplicateFieldValue('Store', 'slug', normalized),
        );
      }
      throw error;
    }

    // The old slug must stop resolving immediately.
    this.cache.clear();
    return new StatusBaseResponseDTO(
      true,
      `Store slug updated to "${normalized}"`,
    );
  }

  async publishProduct(
    productId: string,
    shopId: string,
  ): Promise<StatusBaseResponseDTO> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, shopId },
      select: { isActive: true, name: true },
    });
    if (!product) {
      throw new NotFoundException(resourceNotFound('Product', productId));
    }
    if (!product.isActive) {
      throw new BadRequestException(productNotPublishable(product.name));
    }
    // The DB trigger backfills publishedAt when is_published flips to true.
    await this.prisma.product.update({
      where: { id: productId },
      data: { isPublished: true },
    });
    return new StatusBaseResponseDTO(true, 'Product published successfully');
  }

  async unpublishProduct(
    productId: string,
    shopId: string,
  ): Promise<StatusBaseResponseDTO> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, shopId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(resourceNotFound('Product', productId));
    }
    // The DB trigger clears publishedAt when is_published flips to false.
    await this.prisma.product.update({
      where: { id: productId },
      data: { isPublished: false },
    });
    return new StatusBaseResponseDTO(true, 'Product unpublished successfully');
  }

  async addProductImage(
    productId: string,
    file: UploadedImageFile,
    shopId: string,
  ): Promise<StatusBaseResponseDTO> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, shopId },
      select: { name: true },
    });
    if (!product) {
      throw new NotFoundException(resourceNotFound('Product', productId));
    }

    const count = await this.prisma.productImage.count({
      where: { productId, shopId },
    });
    if (count >= MAX_PRODUCT_IMAGES) {
      throw new BadRequestException(
        imageLimitExceeded(product.name, MAX_PRODUCT_IMAGES),
      );
    }

    const processed = await this.processImage(file);
    const key = `shops/${shopId}/products/${productId}/${randomUUID()}.${processed.ext}`;
    const url = await this.r2.put(key, processed.buffer, processed.contentType);

    try {
      const last = await this.prisma.productImage.findFirst({
        where: { productId, shopId },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const sortOrder = (last?.sortOrder ?? -1) + 1;

      await this.prisma.productImage.create({
        data: { shopId, productId, url, sortOrder },
      });
    } catch (error) {
      // The DB is the source of truth; an orphaned object is harmless, so
      // clean it up best-effort and surface the real DB error.
      await this.r2.deleteByUrl(url);
      throw error;
    }
    return new StatusBaseResponseDTO(true, 'Product image added successfully');
  }

  async listProductImages(
    productId: string,
    shopId: string,
  ): Promise<ResponseProductImageDto[]> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, shopId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(resourceNotFound('Product', productId));
    }
    return this.prisma.productImage.findMany({
      where: { productId, shopId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        url: true,
        sortOrder: true,
      },
    });
  }

  async reorderProductImages(
    productId: string,
    dto: ReorderProductImagesDto,
    shopId: string,
  ): Promise<StatusBaseResponseDTO> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, shopId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException(resourceNotFound('Product', productId));
    }

    const images = await this.prisma.productImage.findMany({
      where: { productId, shopId },
      select: { id: true },
    });
    const existingIds = images.map((i) => i.id).sort();
    const sentIds = [...dto.imageIds].sort();
    if (
      existingIds.length !== sentIds.length ||
      existingIds.some((id, i) => id !== sentIds[i])
    ) {
      throw new BadRequestException(reorderImageMismatch());
    }

    await this.prisma.$transaction(async (tx) => {
      for (const [index, imageId] of dto.imageIds.entries()) {
        await tx.productImage.update({
          where: { id: imageId },
          data: { sortOrder: index },
        });
      }
    });
    return new StatusBaseResponseDTO(
      true,
      'Product images reordered successfully',
    );
  }

  async removeProductImage(
    productId: string,
    imageId: string,
    shopId: string,
  ): Promise<StatusBaseResponseDTO> {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId, shopId },
    });
    if (!image) {
      throw new NotFoundException(resourceNotFound('Product image', imageId));
    }
    await this.prisma.productImage.delete({ where: { id: imageId } });
    // Never fail the request because the object delete failed; the DB row is
    // the source of truth and a stray object is only wasted storage.
    await this.r2.deleteByUrl(image.url);
    return new StatusBaseResponseDTO(
      true,
      'Product image removed successfully',
    );
  }

  /**
   * Validates the upload by content (WF21: "checked by content, not by
   * name"), auto-rotates, caps the longest side and re-encodes — dropping
   * EXIF/GPS metadata with it.
   */
  private async processImage(file: UploadedImageFile): Promise<{
    buffer: Buffer;
    ext: string;
    contentType: string;
  }> {
    // Inputs notably larger than a phone photo are refused before decode so a
    // decompression bomb cannot eat server memory.
    const sharpOptions = { limitInputPixels: 50_000_000 };

    let format: string | undefined;
    try {
      const metadata = await sharp(file.buffer, sharpOptions).metadata();
      format = metadata.format;
    } catch {
      throw new BadRequestException(unsupportedImageType());
    }
    if (!format || !SUPPORTED_IMAGE_FORMATS.has(format)) {
      throw new BadRequestException(unsupportedImageType());
    }

    let buffer: Buffer;
    try {
      buffer = await sharp(file.buffer, sharpOptions)
        .rotate()
        .resize({
          width: MAX_IMAGE_EDGE,
          height: MAX_IMAGE_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();
    } catch {
      throw new BadRequestException(unsupportedImageType());
    }

    if (format === 'jpeg') {
      return { buffer, ext: 'jpg', contentType: 'image/jpeg' };
    }
    if (format === 'png') {
      return { buffer, ext: 'png', contentType: 'image/png' };
    }
    return { buffer, ext: 'webp', contentType: 'image/webp' };
  }

  private buildUpdate(dto: UpdateStoreSettingsDto): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (dto.isEnabled !== undefined) data.isEnabled = dto.isEnabled;
    if (dto.displayName !== undefined)
      data.displayName = dto.displayName?.trim();
    if (dto.about !== undefined) data.about = dto.about?.trim() || null;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl?.trim() || null;
    if (dto.bannerUrl !== undefined)
      data.bannerUrl = dto.bannerUrl?.trim() || null;
    if (dto.whatsappNumber !== undefined)
      data.whatsappNumber = dto.whatsappNumber?.trim() || null;
    if (dto.phoneNumber !== undefined)
      data.phoneNumber = dto.phoneNumber?.trim() || null;
    if (dto.address !== undefined) data.address = dto.address?.trim() || null;
    if (dto.city !== undefined) data.city = dto.city?.trim() || null;
    if (dto.googleMapsUrl !== undefined)
      data.googleMapsUrl = dto.googleMapsUrl?.trim() || null;
    if (dto.openingHours !== undefined)
      data.openingHours = dto.openingHours?.trim() || null;
    if (dto.facebookUrl !== undefined)
      data.facebookUrl = dto.facebookUrl?.trim() || null;
    if (dto.instagramUrl !== undefined)
      data.instagramUrl = dto.instagramUrl?.trim() || null;
    if (dto.showExactStock !== undefined)
      data.showExactStock = dto.showExactStock;
    return data;
  }

  private async shopDisplayName(shopId: string): Promise<string> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { name: true },
    });
    return shop?.name ?? '';
  }

  /**
   * Pick a free slug for a shop that has no settings row yet. The base
   * derivation (slugify / truncate / fallback / reserved) lives in
   * store-slug.helper.ts — shared with onboarding so both paths agree.
   */
  private async nextFreeSlug(shopId: string): Promise<string> {
    const base = storeSlugBase(await this.shopDisplayName(shopId), shopId);
    return nextFreeStoreSlug(base, async (candidate) =>
      Boolean(
        await this.prisma.shopStoreSettings.findUnique({
          where: { slug: candidate },
          select: { slug: true },
        }),
      ),
    );
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { CreateProductDto } from '../dto/create-product.dto.js';
import { UpdateProductDto } from '../dto/update-product.dto.js';
import { ProductQueryFilterDto } from '../dto/product-query.filter.js';
import { ResponseProductDto } from '../dto/response-product.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import {
  resourceNotFound,
  duplicateName,
  duplicateFieldValue,
  trackingTypeLocked,
  stockNotEmptyForTrackingChange,
  productNotPublishable,
} from '../../errors/error.builder.js';
import {
  isUniqueConstraintViolation,
  violatedColumn,
} from '../../helpers/prisma-error-helper.js';
import { BulkPublishProductsDto } from '../dto/bulk-publish-products.dto.js';

/** Everything the response needs, fetched in a single query. */
type ProductRow = Prisma.ProductGetPayload<{
  include: {
    category: { select: { name: true } };
    brand: { select: { name: true } };
    stockLevel: { select: { quantityOnHand: true } };
    _count: { select: { inventoryUnits: { where: { status: 'IN_STOCK' } } } };
  };
}>;

const PRODUCT_INCLUDE = {
  category: { select: { name: true } },
  brand: { select: { name: true } },
  stockLevel: { select: { quantityOnHand: true } },
  _count: { select: { inventoryUnits: { where: { status: 'IN_STOCK' } } } },
} as const;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createProduct(
    dto: CreateProductDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const name = dto.name.trim();
    const sku = dto.sku?.trim() || null;
    const barcode = dto.barcode?.trim() || null;

    // The category/brand FKs carry no shopId, so a raw insert would happily let
    // this shop attach another shop's category. Verify ownership first.
    await this.assertCategoryOwned(dto.categoryId, shopId);
    await this.assertBrandOwned(dto.brandId, shopId);

    try {
      await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            shopId,
            categoryId: dto.categoryId,
            brandId: dto.brandId,
            name,
            trackingType: dto.trackingType,
            model: dto.model?.trim() || null,
            color: dto.color?.trim() || null,
            ram: dto.ram?.trim() || null,
            storage: dto.storage?.trim() || null,
            sku,
            barcode,
            description: dto.description?.trim() || null,
            imageUrl: dto.imageUrl?.trim() || null,
            defaultPurchasePrice: dto.defaultPurchasePrice ?? 0,
            defaultSellingPrice: dto.defaultSellingPrice ?? 0,
            lowStockThreshold: dto.lowStockThreshold ?? 0,
            isActive: dto.isActive ?? true,
          },
        });

        // QUANTITY products get a stock counter immediately. SERIALIZED ones
        // never get one — their stock lives on inventory_units rows (one per IMEI).
        if (dto.trackingType === 'QUANTITY') {
          await tx.stockLevel.create({
            data: {
              productId: product.id,
              shopId,
              quantityOnHand: 0,
              avgUnitCost: 0,
            },
          });
        }
      });
    } catch (error) {
      throw this.mapDuplicate(error, name, sku, barcode);
    }

    return new StatusBaseResponseDTO(true, 'Product created successfully');
  }

  async getProducts(
    query: ProductQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseProductDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.ProductWhereInput = { shopId };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.brandId) where.brandId = query.brandId;
    if (query.trackingType) where.trackingType = query.trackingType;
    if (query.isActive !== undefined && query.isActive !== null) {
      where.isActive = query.isActive;
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      // Top-level keys are ANDed, so this narrows rather than widens the scope.
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { model: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.product.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseProductDto>(
      rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    );
  }

  async getProductById(
    id: string,
    shopId: string,
  ): Promise<ResponseProductDto> {
    const row = await this.prisma.product.findFirst({
      where: { id, shopId },
      include: PRODUCT_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException(resourceNotFound('Product', id));
    }
    return this.toResponse(row);
  }

  async updateProduct(
    id: string,
    dto: UpdateProductDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const existing = await this.prisma.product.findFirst({
      where: { id, shopId },
    });
    if (!existing) {
      throw new NotFoundException(resourceNotFound('Product', id));
    }

    const newName = dto.name?.trim();
    const newSku = dto.sku?.trim();
    const newBarcode = dto.barcode?.trim();

    if (dto.categoryId !== undefined) {
      await this.assertCategoryOwned(dto.categoryId, shopId);
    }
    if (dto.brandId !== undefined) {
      await this.assertBrandOwned(dto.brandId, shopId);
    }

    const trackingTypeChanges =
      dto.trackingType !== undefined &&
      dto.trackingType !== existing.trackingType;

    if (trackingTypeChanges) {
      await this.assertTrackingTypeChangeAllowed(
        id,
        existing.name,
        dto.trackingType!,
      );
    }

    // WF20: an inactive product can never be published — including when one
    // request tries to publish and deactivate at the same time.
    const willBeActive = dto.isActive ?? existing.isActive;
    if (dto.isPublished === true && !willBeActive) {
      throw new BadRequestException(productNotPublishable(existing.name));
    }

    const data: Prisma.ProductUpdateInput = {};
    if (newName !== undefined) data.name = newName;
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }
    if (dto.brandId !== undefined) {
      data.brand = { connect: { id: dto.brandId } };
    }
    if (dto.trackingType !== undefined) data.trackingType = dto.trackingType;
    if (dto.model !== undefined) data.model = dto.model?.trim() || null;
    if (dto.color !== undefined) data.color = dto.color?.trim() || null;
    if (dto.ram !== undefined) data.ram = dto.ram?.trim() || null;
    if (dto.storage !== undefined) data.storage = dto.storage?.trim() || null;
    if (newSku !== undefined) data.sku = newSku || null;
    if (newBarcode !== undefined) data.barcode = newBarcode || null;
    if (dto.description !== undefined)
      data.description = dto.description?.trim() || null;
    if (dto.imageUrl !== undefined)
      data.imageUrl = dto.imageUrl?.trim() || null;
    if (dto.defaultPurchasePrice !== undefined) {
      data.defaultPurchasePrice = dto.defaultPurchasePrice;
    }
    if (dto.defaultSellingPrice !== undefined) {
      data.defaultSellingPrice = dto.defaultSellingPrice;
    }
    if (dto.lowStockThreshold !== undefined) {
      data.lowStockThreshold = dto.lowStockThreshold;
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // Release 1.2 — the public storefront fields. publishedAt is NOT written
    // here: the DB trigger keeps it in step with is_published.
    if (dto.isPublished !== undefined) data.isPublished = dto.isPublished;
    if (dto.publicDescription !== undefined) {
      data.publicDescription = dto.publicDescription?.trim() || null;
    }
    if (dto.contactForPrice !== undefined) {
      data.contactForPrice = dto.contactForPrice;
    }
    if (dto.ptaStatus !== undefined) data.ptaStatus = dto.ptaStatus;

    if (Object.keys(data).length === 0) {
      return new StatusBaseResponseDTO(true, 'Product updated successfully');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data });

        // Keep stock_levels in step with the tracking type. Allowed only because
        // assertTrackingTypeChangeAllowed already proved there is no history.
        if (trackingTypeChanges) {
          if (dto.trackingType === 'QUANTITY') {
            const existingLevel = await tx.stockLevel.findUnique({
              where: { productId: id },
            });
            if (!existingLevel) {
              await tx.stockLevel.create({
                data: {
                  productId: id,
                  shopId,
                  quantityOnHand: 0,
                  avgUnitCost: 0,
                },
              });
            }
          } else {
            await tx.stockLevel.deleteMany({ where: { productId: id } });
          }
        }
      });
    } catch (error) {
      throw this.mapDuplicate(error, newName, newSku, newBarcode);
    }

    return new StatusBaseResponseDTO(true, 'Product updated successfully');
  }

  async deleteProduct(
    id: string,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const result = await this.prisma.product.updateMany({
      where: { id, shopId },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException(resourceNotFound('Product', id));
    }
    return new StatusBaseResponseDTO(true, 'Product deactivated successfully');
  }

  /**
   * WF20 step 5 — bulk publish / unpublish. Every id must belong to this shop
   * (a foreign id is a 404, never a silent skip) and publishing refuses an
   * inactive product, exactly like the single-product path. One transaction:
   * either the whole selection flips or nothing does.
   */
  async publishProducts(
    dto: BulkPublishProductsDto,
    shopId: string,
  ): Promise<StatusBaseResponseDTO> {
    const ids = [...new Set(dto.ids)];
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, shopId },
      select: { id: true, name: true, isActive: true },
    });

    if (products.length !== ids.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = ids.find((id) => !found.has(id))!;
      throw new NotFoundException(resourceNotFound('Product', missing));
    }

    if (dto.isPublished) {
      const inactive = products.find((p) => !p.isActive);
      if (inactive) {
        throw new BadRequestException(productNotPublishable(inactive.name));
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.product.updateMany({
        where: { id: { in: ids }, shopId },
        data: { isPublished: dto.isPublished },
      });
    });

    const count = products.length;
    const word = `${count} product${count === 1 ? '' : 's'}`;
    return new StatusBaseResponseDTO(
      true,
      `${word} ${dto.isPublished ? 'published' : 'unpublished'} successfully`,
    );
  }

  private async assertCategoryOwned(
    categoryId: string,
    shopId: string,
  ): Promise<void> {
    const found = await this.prisma.category.findFirst({
      where: { id: categoryId, shopId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(resourceNotFound('Category', categoryId));
    }
  }

  private async assertBrandOwned(
    brandId: string,
    shopId: string,
  ): Promise<void> {
    const found = await this.prisma.brand.findFirst({
      where: { id: brandId, shopId },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException(resourceNotFound('Brand', brandId));
    }
  }

  /**
   * trackingType is locked the moment the product is referenced by any
   * purchase_items or sale_items row — changing it would silently rewrite the
   * meaning of every stock record already written.
   */
  private async assertTrackingTypeChangeAllowed(
    productId: string,
    productName: string,
    nextType: 'QUANTITY' | 'SERIALIZED',
  ): Promise<void> {
    const [purchaseRefs, saleRefs] = await Promise.all([
      this.prisma.purchaseItem.count({ where: { productId } }),
      this.prisma.saleItem.count({ where: { productId } }),
    ]);
    if (purchaseRefs + saleRefs > 0) {
      throw new BadRequestException(trackingTypeLocked(productName));
    }

    // Going QUANTITY -> SERIALIZED drops the counter, so it must be empty.
    if (nextType === 'SERIALIZED') {
      const level = await this.prisma.stockLevel.findUnique({
        where: { productId },
        select: { quantityOnHand: true },
      });
      if (level && level.quantityOnHand > 0) {
        throw new BadRequestException(
          stockNotEmptyForTrackingChange(productName, level.quantityOnHand),
        );
      }
    }
  }

  /** Turns a Prisma P2002 into the friendliest message we can give. */
  private mapDuplicate(
    error: unknown,
    name?: string,
    sku?: string | null,
    barcode?: string | null,
  ): unknown {
    if (!isUniqueConstraintViolation(error)) return error;

    if (sku && violatedColumn(error, 'sku')) {
      return new BadRequestException(
        duplicateFieldValue('Product', 'SKU', sku),
      );
    }
    if (barcode && violatedColumn(error, 'barcode')) {
      return new BadRequestException(
        duplicateFieldValue('Product', 'barcode', barcode),
      );
    }
    if (name) {
      return new BadRequestException(duplicateName('Product', name));
    }
    return error;
  }

  private toResponse(row: ProductRow): ResponseProductDto {
    const quantityOnHand =
      row.trackingType === 'QUANTITY'
        ? (row.stockLevel?.quantityOnHand ?? 0)
        : row._count.inventoryUnits;

    return {
      id: row.id,
      shopId: row.shopId,
      categoryId: row.categoryId,
      brandId: row.brandId,
      categoryName: row.category.name,
      brandName: row.brand.name,
      name: row.name,
      trackingType: row.trackingType,
      model: row.model,
      color: row.color,
      ram: row.ram,
      storage: row.storage,
      sku: row.sku,
      barcode: row.barcode,
      description: row.description,
      imageUrl: row.imageUrl,
      defaultPurchasePrice: Number(row.defaultPurchasePrice),
      defaultSellingPrice: Number(row.defaultSellingPrice),
      lowStockThreshold: row.lowStockThreshold,
      isActive: row.isActive,
      isPublished: row.isPublished,
      publicDescription: row.publicDescription,
      contactForPrice: row.contactForPrice,
      ptaStatus: row.ptaStatus,
      quantityOnHand,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateBrandDto } from '../dto/create-brand.dto.js';
import { UpdateBrandDto } from '../dto/update-brand.dto.js';
import { BrandQueryFilterDto } from '../dto/brand-query.filter.js';
import { ResponseBrandDto } from '../dto/response-brand.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { resourceNotFound, duplicateName } from '../../errors/error.builder.js';
import { isUniqueConstraintViolation } from '../../helpers/prisma-error-helper.js';

@Injectable()
export class BrandsService {
  private readonly logger = new Logger(BrandsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createBrand(
    dto: CreateBrandDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const name = dto.name.trim();
    try {
      await this.prisma.brand.create({
        data: {
          shopId,
          name,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new BadRequestException(duplicateName('Brand', name));
      }
      throw error;
    }
    // TODO(ai): append audit log once audit-log module is added
    return new StatusBaseResponseDTO(true, 'Brand created successfully');
  }

  async getBrands(
    query: BrandQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseBrandDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: any = { shopId };
    if (query.search) {
      where.name = { contains: query.search.trim(), mode: 'insensitive' };
    }
    if (query.isActive !== undefined && query.isActive !== null) {
      where.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.brand.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseBrandDto>(
      items,
      total,
      page,
      pageSize,
    );
  }

  async getBrandById(id: string, shopId: string): Promise<ResponseBrandDto> {
    const brand = await this.prisma.brand.findFirst({
      where: { id, shopId },
    });
    if (!brand) {
      throw new NotFoundException(resourceNotFound('Brand', id));
    }
    return brand;
  }

  async updateBrand(
    id: string,
    dto: UpdateBrandDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const newName = dto.name?.trim();
    const data: any = {};
    if (newName !== undefined) data.name = newName;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const result = await this.prisma.brand.updateMany({
        where: { id, shopId },
        data,
      });
      if (result.count === 0) {
        throw new NotFoundException(resourceNotFound('Brand', id));
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error) && newName !== undefined) {
        throw new BadRequestException(duplicateName('Brand', newName));
      }
      throw error;
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(true, 'Brand updated successfully');
  }

  async deleteBrand(
    id: string,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const result = await this.prisma.brand.updateMany({
      where: { id, shopId },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException(resourceNotFound('Brand', id));
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(true, 'Brand deactivated successfully');
  }
}

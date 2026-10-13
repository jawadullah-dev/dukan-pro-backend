import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateCategoryDto } from '../dto/create-category.dto.js';
import { UpdateCategoryDto } from '../dto/update-category.dto.js';
import { CategoryQueryFilterDto } from '../dto/category-query.filter.js';
import { ResponseCategoryDto } from '../dto/response-category.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { resourceNotFound, duplicateName } from '../../errors/error.builder.js';
import { isUniqueConstraintViolation } from '../../helpers/prisma-error-helper.js';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createCategory(
    dto: CreateCategoryDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const name = dto.name.trim();
    try {
      await this.prisma.category.create({
        data: {
          shopId,
          name,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new BadRequestException(duplicateName('Category', name));
      }
      throw error;
    }
    // TODO(ai): append audit log once audit-log module is added
    return new StatusBaseResponseDTO(true, 'Category created successfully');
  }

  async getCategories(
    query: CategoryQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseCategoryDto>> {
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
      this.prisma.category.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.category.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseCategoryDto>(
      items,
      total,
      page,
      pageSize,
    );
  }

  async getCategoryById(
    id: string,
    shopId: string,
  ): Promise<ResponseCategoryDto> {
    const category = await this.prisma.category.findFirst({
      where: { id, shopId },
    });
    if (!category) {
      throw new NotFoundException(resourceNotFound('Category', id));
    }
    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const newName = dto.name?.trim();
    const data: any = {};
    if (newName !== undefined) data.name = newName;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      const result = await this.prisma.category.updateMany({
        where: { id, shopId },
        data,
      });
      if (result.count === 0) {
        throw new NotFoundException(resourceNotFound('Category', id));
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error) && newName !== undefined) {
        throw new BadRequestException(duplicateName('Category', newName));
      }
      throw error;
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(true, 'Category updated successfully');
  }

  async deleteCategory(
    id: string,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const result = await this.prisma.category.updateMany({
      where: { id, shopId },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException(resourceNotFound('Category', id));
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(true, 'Category deactivated successfully');
  }
}

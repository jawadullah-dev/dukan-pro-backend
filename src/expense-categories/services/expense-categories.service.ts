import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateExpenseCategoryDto } from '../dto/create-expense-category.dto.js';
import { UpdateExpenseCategoryDto } from '../dto/update-expense-category.dto.js';
import { ExpenseCategoryQueryFilterDto } from '../dto/expense-category-query.filter.js';
import { ResponseExpenseCategoryDto } from '../dto/response-expense-category.dto.js';
import { StatusBaseResponseDTO } from '../../common-dto/response/status-base-response.dto.js';
import { PaginatedResponseDTO } from '../../common-dto/response/paginated-response.dto.js';
import {
  getSkipNumber,
  normalizePagination,
} from '../../helpers/paginate-helper.js';
import { resourceNotFound, duplicateName } from '../../errors/error.builder.js';
import { isUniqueConstraintViolation } from '../../helpers/prisma-error-helper.js';

@Injectable()
export class ExpenseCategoriesService {
  private readonly logger = new Logger(ExpenseCategoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createExpenseCategory(
    dto: CreateExpenseCategoryDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const name = dto.name.trim();
    try {
      await this.prisma.expenseCategory.create({
        data: {
          shopId,
          name,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new BadRequestException(duplicateName('Expense category', name));
      }
      throw error;
    }
    // TODO(ai): append audit log once audit-log module is added
    return new StatusBaseResponseDTO(
      true,
      'Expense category created successfully',
    );
  }

  async getExpenseCategories(
    query: ExpenseCategoryQueryFilterDto,
    shopId: string,
  ): Promise<PaginatedResponseDTO<ResponseExpenseCategoryDto>> {
    const { page, pageSize } = normalizePagination(
      query.page,
      query.pageSize,
      100,
    );
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';

    const where: any = { shopId };
    if (query.search) {
      where.name = { contains: query.search.trim(), mode: 'insensitive' };
    }
    if (query.isActive !== undefined && query.isActive !== null) {
      where.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where,
        skip: getSkipNumber(page, pageSize),
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.expenseCategory.count({ where }),
    ]);

    return new PaginatedResponseDTO<ResponseExpenseCategoryDto>(
      items,
      total,
      page,
      pageSize,
    );
  }

  async getExpenseCategoryById(
    id: string,
    shopId: string,
  ): Promise<ResponseExpenseCategoryDto> {
    const expenseCategory = await this.prisma.expenseCategory.findFirst({
      where: { id, shopId },
    });
    if (!expenseCategory) {
      throw new NotFoundException(resourceNotFound('Expense category', id));
    }
    return expenseCategory;
  }

  async updateExpenseCategory(
    id: string,
    dto: UpdateExpenseCategoryDto,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const newName = dto.name?.trim();
    const data: any = {};
    if (newName !== undefined) data.name = newName;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      const result = await this.prisma.expenseCategory.updateMany({
        where: { id, shopId },
        data,
      });
      if (result.count === 0) {
        throw new NotFoundException(resourceNotFound('Expense category', id));
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error) && newName !== undefined) {
        throw new BadRequestException(
          duplicateName('Expense category', newName),
        );
      }
      throw error;
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(
      true,
      'Expense category updated successfully',
    );
  }

  async deleteExpenseCategory(
    id: string,
    shopId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _userId: string,
  ): Promise<StatusBaseResponseDTO> {
    const result = await this.prisma.expenseCategory.updateMany({
      where: { id, shopId },
      data: { isActive: false },
    });
    if (result.count === 0) {
      throw new NotFoundException(resourceNotFound('Expense category', id));
    }
    // TODO(ai): append audit log
    return new StatusBaseResponseDTO(
      true,
      'Expense category deactivated successfully',
    );
  }
}

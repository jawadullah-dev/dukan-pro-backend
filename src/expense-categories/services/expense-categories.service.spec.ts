import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { ExpenseCategoriesService } from './expense-categories.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateExpenseCategoryDto } from '../dto/create-expense-category.dto.js';

const prismaStub = {
  expenseCategory: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.0.0',
  });

describe('ExpenseCategoriesService', () => {
  let service: ExpenseCategoriesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseCategoriesService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<ExpenseCategoriesService>(ExpenseCategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createExpenseCategory', () => {
    it('trims the name and defaults isActive to true', async () => {
      prismaStub.expenseCategory.create.mockResolvedValue({});

      await service.createExpenseCategory(
        { name: '  Electricity  ' },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.expenseCategory.create).toHaveBeenCalledWith({
        data: { shopId: 'shop-1', name: 'Electricity', isActive: true },
      });
    });

    it('never trusts a shopId from the dto', async () => {
      prismaStub.expenseCategory.create.mockResolvedValue({});

      await service.createExpenseCategory(
        {
          name: 'Rent',
          shopId: 'attacker-shop',
        } as unknown as CreateExpenseCategoryDto,
        'real-shop',
        'user-1',
      );

      expect(prismaStub.expenseCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shopId: 'real-shop' }),
        }),
      );
    });

    it('turns a duplicate name into a friendly 400', async () => {
      prismaStub.expenseCategory.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.createExpenseCategory({ name: 'Rent' }, 'shop-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rethrows non-unique database errors untouched', async () => {
      const boom = new Error('connection lost');
      prismaStub.expenseCategory.create.mockRejectedValue(boom);

      await expect(
        service.createExpenseCategory({ name: 'Rent' }, 'shop-1', 'user-1'),
      ).rejects.toThrow(boom);
    });
  });

  describe('getExpenseCategories', () => {
    it('scopes the list to the shop and sorts by name ascending by default', async () => {
      prismaStub.expenseCategory.findMany.mockResolvedValue([]);
      prismaStub.expenseCategory.count.mockResolvedValue(0);

      await service.getExpenseCategories({}, 'shop-1');

      expect(prismaStub.expenseCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: 'shop-1' },
          orderBy: { name: 'asc' },
        }),
      );
    });

    it('applies the search and isActive filters', async () => {
      prismaStub.expenseCategory.findMany.mockResolvedValue([]);
      prismaStub.expenseCategory.count.mockResolvedValue(0);

      await service.getExpenseCategories(
        { search: ' rent ', isActive: true },
        'shop-1',
      );

      expect(prismaStub.expenseCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: 'shop-1',
            name: { contains: 'rent', mode: 'insensitive' },
            isActive: true,
          },
        }),
      );
    });

    it('sorts by createdAt descending when asked', async () => {
      prismaStub.expenseCategory.findMany.mockResolvedValue([]);
      prismaStub.expenseCategory.count.mockResolvedValue(0);

      await service.getExpenseCategories(
        { sortBy: 'createdAt', sortOrder: 'desc' },
        'shop-1',
      );

      expect(prismaStub.expenseCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('getExpenseCategoryById', () => {
    it('throws 404 when the row is missing or owned by another shop', async () => {
      prismaStub.expenseCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.getExpenseCategoryById('missing-id', 'shop-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateExpenseCategory', () => {
    it('throws 404 when the row is missing or owned by another shop', async () => {
      prismaStub.expenseCategory.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateExpenseCategory(
          'missing-id',
          { name: 'Rent' },
          'shop-1',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('turns renaming to an existing name into a friendly 400', async () => {
      prismaStub.expenseCategory.updateMany.mockRejectedValue(
        uniqueViolation(),
      );

      await expect(
        service.updateExpenseCategory(
          'cat-1',
          { name: 'Taken' },
          'shop-1',
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('only sends the fields that were provided', async () => {
      prismaStub.expenseCategory.updateMany.mockResolvedValue({ count: 1 });

      await service.updateExpenseCategory(
        'cat-1',
        { isActive: false },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.expenseCategory.updateMany).toHaveBeenCalledWith({
        where: { id: 'cat-1', shopId: 'shop-1' },
        data: { isActive: false },
      });
    });
  });

  describe('deleteExpenseCategory', () => {
    it('soft deletes instead of removing the row', async () => {
      prismaStub.expenseCategory.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteExpenseCategory('cat-1', 'shop-1', 'user-1');

      expect(prismaStub.expenseCategory.updateMany).toHaveBeenCalledWith({
        where: { id: 'cat-1', shopId: 'shop-1' },
        data: { isActive: false },
      });
    });

    it('throws 404 when the row is missing or owned by another shop', async () => {
      prismaStub.expenseCategory.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteExpenseCategory('missing-id', 'shop-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

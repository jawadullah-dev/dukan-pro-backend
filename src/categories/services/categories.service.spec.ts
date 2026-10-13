import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { CategoriesService } from './categories.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateCategoryDto } from '../dto/create-category.dto.js';

const prismaStub = {
  category: {
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

describe('CategoriesService', () => {
  let service: CategoriesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createCategory', () => {
    it('trims the name and defaults isActive to true', async () => {
      prismaStub.category.create.mockResolvedValue({});

      await service.createCategory(
        { name: '  Mobile Phones  ' },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.category.create).toHaveBeenCalledWith({
        data: { shopId: 'shop-1', name: 'Mobile Phones', isActive: true },
      });
    });

    it('never trusts a shopId from the dto', async () => {
      prismaStub.category.create.mockResolvedValue({});

      await service.createCategory(
        {
          name: 'Phones',
          shopId: 'attacker-shop',
        } as unknown as CreateCategoryDto,
        'real-shop',
        'user-1',
      );

      expect(prismaStub.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shopId: 'real-shop' }),
        }),
      );
    });

    it('turns a duplicate name into a friendly 400', async () => {
      prismaStub.category.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.createCategory({ name: 'Phones' }, 'shop-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rethrows non-unique database errors untouched', async () => {
      const boom = new Error('connection lost');
      prismaStub.category.create.mockRejectedValue(boom);

      await expect(
        service.createCategory({ name: 'Phones' }, 'shop-1', 'user-1'),
      ).rejects.toThrow(boom);
    });
  });

  describe('updateCategory', () => {
    it('throws 404 when the row is missing or owned by another shop', async () => {
      prismaStub.category.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateCategory(
          'missing-id',
          { name: 'Phones' },
          'shop-1',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('turns renaming to an existing name into a friendly 400', async () => {
      prismaStub.category.updateMany.mockRejectedValue(uniqueViolation());

      await expect(
        service.updateCategory('cat-1', { name: 'Taken' }, 'shop-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('only sends the fields that were provided', async () => {
      prismaStub.category.updateMany.mockResolvedValue({ count: 1 });

      await service.updateCategory(
        'cat-1',
        { isActive: false },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.category.updateMany).toHaveBeenCalledWith({
        where: { id: 'cat-1', shopId: 'shop-1' },
        data: { isActive: false },
      });
    });
  });

  describe('deleteCategory', () => {
    it('soft deletes instead of removing the row', async () => {
      prismaStub.category.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteCategory('cat-1', 'shop-1', 'user-1');

      expect(prismaStub.category.updateMany).toHaveBeenCalledWith({
        where: { id: 'cat-1', shopId: 'shop-1' },
        data: { isActive: false },
      });
    });
  });
});

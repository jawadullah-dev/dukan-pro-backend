import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { CategoriesController } from './categories.controller.js';
import { CategoriesService } from '../services/categories.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

const prismaStub = {
  category: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

/**
 * Smoke test: verifies Nest can construct the categoriesController + categoriesService.
 * Guards and their heavy dependencies (JwtService, AppConfigurationService)
 * are swapped out so the spec stays lightweight. Real behavior (including
 * guard enforcement) is verified via e2e tests under test/.
 */
describe('CategoriesController', () => {
  let controller: CategoriesController;
  let categoriesService: CategoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: prismaStub },
        {
          provide: AuthGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        {
          provide: JwtService,
          useValue: { verifyAsync: jest.fn(), sign: jest.fn() },
        },
        {
          provide: AppConfigurationService,
          useValue: {
            get: jest.fn().mockReturnValue({ jwtSecret: 'test-secret' }),
            auth: { jwtSecret: 'test-secret' },
          },
        },
      ],
    }).compile();

    controller = module.get<CategoriesController>(CategoriesController);
    categoriesService = module.get<CategoriesService>(CategoriesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(categoriesService, 'getCategoryById')
      .mockRejectedValue(new NotFoundException('Category not found'));

    await expect(
      controller.getCategoryById('missing-id', {
        user: { shopId: 'shop-1' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(categoriesService, 'getCategoryById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getCategoryById('category-1', {
        user: { shopId: 'shop-1' },
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

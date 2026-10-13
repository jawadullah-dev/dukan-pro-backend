import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ExpenseCategoriesController } from './expense-categories.controller.js';
import { ExpenseCategoriesService } from '../services/expense-categories.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

const prismaStub = {
  expenseCategory: {
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
 * Smoke test: verifies Nest can construct the ExpenseCategoriesController +
 * ExpenseCategoriesService. Guards and their heavy dependencies (JwtService,
 * AppConfigurationService) are swapped out so the spec stays lightweight.
 * Real behavior (including guard enforcement) is verified via e2e tests under test/.
 */
describe('ExpenseCategoriesController', () => {
  let controller: ExpenseCategoriesController;
  let expenseCategoriesService: ExpenseCategoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpenseCategoriesController],
      providers: [
        ExpenseCategoriesService,
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

    controller = module.get<ExpenseCategoriesController>(
      ExpenseCategoriesController,
    );
    expenseCategoriesService = module.get<ExpenseCategoriesService>(
      ExpenseCategoriesService,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(expenseCategoriesService, 'getExpenseCategoryById')
      .mockRejectedValue(new NotFoundException('Expense category not found'));

    await expect(
      controller.getExpenseCategoryById('missing-id', {
        user: { shopId: 'shop-1' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(expenseCategoriesService, 'getExpenseCategoryById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getExpenseCategoryById('category-1', {
        user: { shopId: 'shop-1' },
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

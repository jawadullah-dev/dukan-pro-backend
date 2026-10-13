import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ProductsController } from './products.controller.js';
import { ProductsService } from '../services/products.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import {
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

const prismaStub = {
  product: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  category: { findFirst: jest.fn() },
  brand: { findFirst: jest.fn() },
  stockLevel: {
    create: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  },
  purchaseItem: { count: jest.fn() },
  saleItem: { count: jest.fn() },
  $transaction: jest.fn(),
};

/**
 * Smoke test: verifies Nest can construct the ProductsController + ProductsService.
 * Guards and their heavy dependencies (JwtService, AppConfigurationService)
 * are swapped out so the spec stays lightweight. Real behavior (including
 * guard enforcement) is verified via e2e tests under test/.
 */
describe('ProductsController', () => {
  let controller: ProductsController;
  let productsService: ProductsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        ProductsService,
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

    controller = module.get<ProductsController>(ProductsController);
    productsService = module.get<ProductsService>(ProductsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId from the JWT, never from the body', async () => {
    const spy = jest.spyOn(productsService, 'createProduct').mockResolvedValue({
      status: true,
      message: 'Product created successfully',
    });

    await controller.createProduct(
      {
        name: 'Galaxy A15',
        categoryId: 'cat-1',
        brandId: 'brand-1',
        trackingType: 'QUANTITY',
      } as any,
      { user: { shopId: 'shop-from-jwt', userId: 'user-1' } } as any,
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(productsService, 'getProductById')
      .mockRejectedValue(new NotFoundException('Product not found'));

    await expect(
      controller.getProductById('missing-id', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves a service 400 response', async () => {
    jest
      .spyOn(productsService, 'createProduct')
      .mockRejectedValue(new BadRequestException('duplicate'));

    await expect(
      controller.createProduct(
        {} as any,
        { user: { shopId: 'shop-1' } } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(productsService, 'getProductById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getProductById('prod-1', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(productsService, 'getProducts').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getProducts({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Products fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });
});

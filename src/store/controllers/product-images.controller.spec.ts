import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ProductImagesController } from './product-images.controller.js';
import { StoreService } from '../services/store.service.js';
import { StoreCacheService } from '../services/store-cache.service.js';
import { R2StorageService } from '../services/r2-storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

const prismaStub = {
  shopStoreSettings: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  shop: { findUnique: jest.fn() },
  product: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  productImage: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  $transaction: jest.fn(),
};

/**
 * Smoke test: Nest can construct the photo controller with StoreService —
 * the image rules (max 5, https-only, full-list reorder) live there, while
 * the controller only carries the doc's /products/:id/images route shape.
 */
describe('ProductImagesController', () => {
  let controller: ProductImagesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductImagesController],
      providers: [
        StoreService,
        StoreCacheService,
        {
          provide: R2StorageService,
          useValue: {
            put: jest.fn().mockResolvedValue('https://pub-test.r2.dev/x.jpg'),
            deleteByUrl: jest.fn(),
            buildPublicUrl: jest.fn(),
          },
        },
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

    controller = module.get<ProductImagesController>(ProductImagesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

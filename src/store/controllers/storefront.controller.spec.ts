import { Test, TestingModule } from '@nestjs/testing';
import { StorefrontController } from './storefront.controller.js';
import { StorefrontService } from '../services/storefront.service.js';
import { StoreCacheService } from '../services/store-cache.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const prismaStub = {
  shopStoreSettings: { findUnique: jest.fn() },
  shop: { findUnique: jest.fn() },
  product: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn(),
};

/**
 * Smoke test: verifies Nest can construct StorefrontController with its
 * public-surface deps (StorefrontService + slug cache + the rate-limit guard
 * the controller is guarded with). This controller carries NO auth guard — it
 * is the public storefront, reachable without a token by design.
 */
describe('StorefrontController', () => {
  let controller: StorefrontController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorefrontController],
      providers: [
        StorefrontService,
        StoreCacheService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    controller = module.get<StorefrontController>(StorefrontController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

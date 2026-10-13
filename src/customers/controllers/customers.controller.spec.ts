import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from '../services/customers.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

const prismaStub = {
  customer: {
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
 * Smoke test: verifies Nest can construct the CustomersController +
 * CustomersService. Guards and their heavy dependencies (JwtService,
 * AppConfigurationService) are swapped out so the spec stays lightweight.
 * Real behavior (including guard enforcement) is verified via e2e tests under test/.
 */
describe('CustomersController', () => {
  let controller: CustomersController;
  let customersService: CustomersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        CustomersService,
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

    controller = module.get<CustomersController>(CustomersController);
    customersService = module.get<CustomersService>(CustomersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(customersService, 'getCustomerById')
      .mockRejectedValue(new NotFoundException('Customer not found'));

    await expect(
      controller.getCustomerById('missing-id', {
        user: { shopId: 'shop-1' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(customersService, 'getCustomerById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getCustomerById('customer-1', {
        user: { shopId: 'shop-1' },
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

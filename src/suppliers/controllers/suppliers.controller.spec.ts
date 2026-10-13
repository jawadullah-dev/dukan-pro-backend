import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from '../services/suppliers.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import {
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';

const prismaStub = {
  supplier: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
};

/**
 * Smoke test: verifies Nest can construct the SuppliersController + service.
 * Guards and their heavy dependencies (JwtService, AppConfigurationService)
 * are swapped out so the spec stays lightweight. Real behavior (including
 * guard enforcement) is verified via e2e tests under test/.
 */
describe('SuppliersController', () => {
  let controller: SuppliersController;
  let suppliersService: SuppliersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SuppliersController],
      providers: [
        SuppliersService,
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

    controller = module.get<SuppliersController>(SuppliersController);
    suppliersService = module.get<SuppliersService>(SuppliersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId from the JWT, never from the body', async () => {
    const spy = jest
      .spyOn(suppliersService, 'createSupplier')
      .mockResolvedValue({
        status: true,
        message: 'Supplier created successfully',
      });

    await controller.createSupplier({ name: 'ABC Mobiles' }, {
      user: { shopId: 'shop-from-jwt', userId: 'user-1' },
    } as any);

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('preserves a service 404 response', async () => {
    jest
      .spyOn(suppliersService, 'getSupplierById')
      .mockRejectedValue(new NotFoundException('Supplier not found'));

    await expect(
      controller.getSupplierById('missing-id', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('preserves a service 403 when the Walk-in seller is protected', async () => {
    jest
      .spyOn(suppliersService, 'deleteSupplier')
      .mockRejectedValue(new ForbiddenException('protected'));

    await expect(
      controller.deleteSupplier('sup-1', {
        user: { shopId: 'shop-1', userId: 'user-1' },
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('preserves a service 400 response', async () => {
    jest
      .spyOn(suppliersService, 'createSupplier')
      .mockRejectedValue(new BadRequestException('bad input'));

    await expect(
      controller.createSupplier(
        {} as any,
        {
          user: { shopId: 'shop-1' },
        } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(suppliersService, 'getSupplierById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getSupplierById('sup-1', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(suppliersService, 'getSuppliers').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getSuppliers({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Suppliers fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('scopes a list request to the JWT shop', async () => {
    const spy = jest.spyOn(suppliersService, 'getSuppliers').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    await controller.getSuppliers({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { BrandsService } from './brands.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

const prismaStub = {
  brand: {
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

describe('BrandsService', () => {
  let service: BrandsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BrandsService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<BrandsService>(BrandsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a trimmed brand for the supplied shop', async () => {
    prismaStub.brand.create.mockResolvedValue({});

    await service.createBrand({ name: '  Samsung  ' }, 'shop-1', 'user-1');

    expect(prismaStub.brand.create).toHaveBeenCalledWith({
      data: { shopId: 'shop-1', name: 'Samsung', isActive: true },
    });
  });

  it('rejects a duplicate brand name with a friendly error', async () => {
    prismaStub.brand.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '7.0.0',
      }),
    );

    await expect(
      service.createBrand({ name: 'Samsung' }, 'shop-1', 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates only a brand owned by the supplied shop', async () => {
    prismaStub.brand.updateMany.mockResolvedValue({ count: 1 });

    await service.updateBrand(
      'brand-1',
      { isActive: false },
      'shop-1',
      'user-1',
    );

    expect(prismaStub.brand.updateMany).toHaveBeenCalledWith({
      where: { id: 'brand-1', shopId: 'shop-1' },
      data: { isActive: false },
    });
  });

  it('returns not found when an update matches no row for the shop', async () => {
    prismaStub.brand.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateBrand('brand-1', { name: 'Apple' }, 'shop-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('deactivates only a brand owned by the supplied shop', async () => {
    prismaStub.brand.updateMany.mockResolvedValue({ count: 1 });

    await service.deleteBrand('brand-1', 'shop-1', 'user-1');

    expect(prismaStub.brand.updateMany).toHaveBeenCalledWith({
      where: { id: 'brand-1', shopId: 'shop-1' },
      data: { isActive: false },
    });
  });
});

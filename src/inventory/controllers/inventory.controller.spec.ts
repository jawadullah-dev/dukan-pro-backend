import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from '../services/inventory.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { BadRequestException } from '@nestjs/common';

const prismaStub = { $transaction: jest.fn() };

function mockRes() {
  const status = jest.fn().mockReturnThis();
  return { status, json: jest.fn() } as any;
}

describe('InventoryController', () => {
  let controller: InventoryController;
  let inventoryService: InventoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        InventoryService,
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

    controller = module.get<InventoryController>(InventoryController);
    inventoryService = module.get<InventoryService>(InventoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns 201 when a row was actually written', async () => {
    jest.spyOn(inventoryService, 'createAdjustment').mockResolvedValue({
      kind: 'created',
      message: 'Stock change recorded successfully',
    });
    const res = mockRes();

    const body = await controller.createAdjustment(
      {} as any,
      {
        user: { shopId: 'shop-1' },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(body).toEqual({
      message: 'Stock change recorded successfully',
      data: {
        kind: 'created',
        message: 'Stock change recorded successfully',
      },
    });
  });

  it('returns 200 (nothing written) when the count already matched', async () => {
    jest.spyOn(inventoryService, 'createAdjustment').mockResolvedValue({
      kind: 'nochange',
      message: 'Counted matches the system — no change recorded',
    });
    const res = mockRes();

    await controller.createAdjustment(
      {} as any,
      {
        user: { shopId: 'shop-1' },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('preserves a service 400 (shape rule) response', async () => {
    jest
      .spyOn(inventoryService, 'createAdjustment')
      .mockRejectedValue(new BadRequestException('bad adjustment'));

    await expect(
      controller.createAdjustment(
        {} as any,
        {
          user: { shopId: 'shop-1' },
        },
        mockRes(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(inventoryService, 'createAdjustment')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.createAdjustment(
        {} as any,
        {
          user: { shopId: 'shop-1' },
        },
        mockRes(),
      ),
    ).rejects.toThrow('Failed to record inventory adjustment');
  });
});

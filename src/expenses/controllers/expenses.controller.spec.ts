import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ExpensesController } from './expenses.controller.js';
import { ExpensesService } from '../services/expenses.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';

const prismaStub = {
  expense: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  expenseCategory: { findFirst: jest.fn() },
  cashMovement: {
    create: jest.fn(),
    aggregate: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

/** Minimal express Response that records the status the controller sets. */
function resStub() {
  return { status: jest.fn().mockReturnThis() } as any;
}

describe('ExpensesController', () => {
  let controller: ExpensesController;
  let expensesService: ExpensesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [
        ExpensesService,
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

    controller = module.get<ExpensesController>(ExpensesController);
    expensesService = module.get<ExpensesService>(ExpensesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the shopId and userId from the JWT, never from the body', async () => {
    const spy = jest.spyOn(expensesService, 'createExpense').mockResolvedValue({
      status: true,
      message: 'Expense recorded successfully',
    });

    await controller.createExpense(
      { categoryId: 'cat-1', amount: 500000, expenseDate: '2026-10-06' },
      { user: { shopId: 'shop-from-jwt', userId: 'user-1' } } as any,
      resStub(),
    );

    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      'shop-from-jwt',
      'user-1',
    );
  });

  it('returns 201 when a row was actually written', async () => {
    jest.spyOn(expensesService, 'createExpense').mockResolvedValue({
      status: true,
      message: 'Expense recorded successfully',
    });
    const http = resStub();

    await controller.createExpense(
      { categoryId: 'cat-1', amount: 500000, expenseDate: '2026-10-06' },
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(http.status).toHaveBeenCalledWith(201);
  });

  it('surfaces the overdraft prompt in the top-level message', async () => {
    jest.spyOn(expensesService, 'createExpense').mockResolvedValue({
      confirmOverdraft: true,
      shortfall: 200000,
      message:
        'This expense would take your cash below zero by 200000 paisa. Send confirmOverdraft: true to save it anyway.',
    });
    const http = resStub();

    const res = await controller.createExpense(
      { categoryId: 'cat-1', amount: 700000, expenseDate: '2026-10-06' },
      { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      http,
    );

    expect(res.data).toEqual(
      expect.objectContaining({ confirmOverdraft: true, shortfall: 200000 }),
    );
    // Nothing was created, so the prompt must not claim 201.
    expect(http.status).toHaveBeenCalledWith(200);
  });

  it('preserves a service 400 response', async () => {
    jest
      .spyOn(expensesService, 'createExpense')
      .mockRejectedValue(new BadRequestException('bad input'));

    await expect(
      controller.createExpense(
        {} as any,
        { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
        resStub(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('preserves a service 404 response on getExpenseById', async () => {
    jest
      .spyOn(expensesService, 'getExpenseById')
      .mockRejectedValue(new NotFoundException('Expense not found'));

    await expect(
      controller.getExpenseById('missing', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 500 for an unexpected service error', async () => {
    jest
      .spyOn(expensesService, 'getExpenseById')
      .mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.getExpenseById('e-1', {
        user: { shopId: 'shop-1' },
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('wraps a successful list in the documented envelope', async () => {
    jest.spyOn(expensesService, 'getExpenses').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    const res = await controller.getExpenses({ page: 1 }, {
      user: { shopId: 'shop-1' },
    } as any);

    expect(res.message).toBe('Expenses fetched successfully');
    expect(res.data).toEqual({ page: 1, pageSize: 10, total: 0, items: [] });
  });

  it('scopes a list request to the JWT shop', async () => {
    const spy = jest.spyOn(expensesService, 'getExpenses').mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 0,
      items: [],
    });

    await controller.getExpenses({ page: 1 }, {
      user: { shopId: 'shop-7' },
    } as any);

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'shop-7');
  });

  it('preserves a service 400 on cancelExpense', async () => {
    jest
      .spyOn(expensesService, 'cancelExpense')
      .mockRejectedValue(new BadRequestException('already cancelled'));

    await expect(
      controller.cancelExpense(
        'e-1',
        { cancelReason: 'mistake' } as any,
        { user: { shopId: 'shop-1', userId: 'user-1' } } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

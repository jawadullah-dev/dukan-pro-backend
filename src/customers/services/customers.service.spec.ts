import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateCustomerDto } from '../dto/create-customer.dto.js';
import { UpdateCustomerDto } from '../dto/update-customer.dto.js';

const prismaStub = {
  customer: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  sale: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
  saleReturn: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

const customerRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'cust-1',
  shopId: 'shop-1',
  name: 'Ali Khan',
  phone: '03001234567',
  address: null,
  notes: null,
  openingBalance: BigInt(5000000),
  isActive: true,
  createdAt: new Date('2026-10-05T09:20:00.000Z'),
  updatedAt: new Date('2026-10-05T09:20:00.000Z'),
  ...overrides,
});

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createCustomer', () => {
    it('trims text, normalises the phone, defaults isActive to true and opening balance to 0', async () => {
      prismaStub.customer.create.mockResolvedValue({});

      await service.createCustomer(
        { name: '  Ali Khan  ', phone: ' 0300-1234567 ' },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.customer.create).toHaveBeenCalledWith({
        data: {
          shopId: 'shop-1',
          name: 'Ali Khan',
          phone: '923001234567',
          address: null,
          notes: null,
          openingBalance: BigInt(0),
          isActive: true,
        },
      });
    });

    it('keeps an unrecognisable phone as typed instead of rejecting it', async () => {
      prismaStub.customer.create.mockResolvedValue({});

      await service.createCustomer(
        { name: 'Ali Khan', phone: '+44 20 7946 0958' },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: '442079460958',
          }),
        }),
      );
    });

    it('stores the opening balance as a bigint', async () => {
      prismaStub.customer.create.mockResolvedValue({});

      await service.createCustomer(
        { name: 'Ali Khan', openingBalance: 5000000 },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ openingBalance: BigInt(5000000) }),
        }),
      );
    });

    it('never trusts a shopId from the dto', async () => {
      prismaStub.customer.create.mockResolvedValue({});

      await service.createCustomer(
        {
          name: 'Ali Khan',
          shopId: 'attacker-shop',
        } as unknown as CreateCustomerDto,
        'real-shop',
        'user-1',
      );

      expect(prismaStub.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shopId: 'real-shop' }),
        }),
      );
    });

    it('rethrows database errors untouched', async () => {
      const boom = new Error('connection lost');
      prismaStub.customer.create.mockRejectedValue(boom);

      await expect(
        service.createCustomer({ name: 'Ali Khan' }, 'shop-1', 'user-1'),
      ).rejects.toThrow(boom);
    });
  });

  describe('getCustomers', () => {
    it('scopes the list to the shop and returns openingBalance as a number', async () => {
      prismaStub.customer.findMany.mockResolvedValue([customerRow()]);
      prismaStub.customer.count.mockResolvedValue(1);

      const result: any = await service.getCustomers({}, 'shop-1');

      expect(prismaStub.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: 'shop-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result.items[0].openingBalance).toBe(5000000);
    });

    it('searches name and phone', async () => {
      prismaStub.customer.findMany.mockResolvedValue([]);
      prismaStub.customer.count.mockResolvedValue(0);

      await service.getCustomers({ search: ' ali ', isActive: true }, 'shop-1');

      expect(prismaStub.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: 'shop-1',
            OR: [
              { name: { contains: 'ali', mode: 'insensitive' } },
              { phone: { contains: 'ali' } },
            ],
            isActive: true,
          },
        }),
      );
    });
  });

  describe('getCustomerById', () => {
    it('throws 404 when the row is missing or owned by another shop', async () => {
      prismaStub.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.getCustomerById('missing-id', 'shop-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns openingBalance as a number', async () => {
      prismaStub.customer.findFirst.mockResolvedValue(customerRow());

      const result = await service.getCustomerById('cust-1', 'shop-1');

      expect(result.openingBalance).toBe(5000000);
    });
  });

  describe('updateCustomer', () => {
    it('throws 404 when the row is missing or owned by another shop', async () => {
      prismaStub.customer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateCustomer(
          'missing-id',
          { name: 'Ali Raza' },
          'shop-1',
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('only sends the fields that were provided', async () => {
      prismaStub.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.updateCustomer(
        'cust-1',
        { isActive: false },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', shopId: 'shop-1' },
        data: { isActive: false },
      });
    });

    it('updates the opening balance when it is sent (WF1 day-0 correction)', async () => {
      prismaStub.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.updateCustomer(
        'cust-1',
        { openingBalance: 7500000 },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', shopId: 'shop-1' },
        data: { openingBalance: BigInt(7500000) },
      });
    });

    it('leaves the opening balance alone when it is omitted', async () => {
      prismaStub.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.updateCustomer(
        'cust-1',
        { name: 'Ali Raza' },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', shopId: 'shop-1' },
        data: { name: 'Ali Raza' },
      });
      expect(
        prismaStub.customer.updateMany.mock.calls[0][0].data,
      ).not.toHaveProperty('openingBalance');
    });

    it('rejects a null name with 400 instead of crashing', async () => {
      await expect(
        service.updateCustomer(
          'cust-1',
          { name: null } as unknown as UpdateCustomerDto,
          'shop-1',
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaStub.customer.updateMany).not.toHaveBeenCalled();
    });

    it.each([['phone'], ['address'], ['notes']])(
      'clears %s when it is sent as null',
      async (field) => {
        prismaStub.customer.updateMany.mockResolvedValue({ count: 1 });

        await service.updateCustomer(
          'cust-1',
          { [field]: null },
          'shop-1',
          'user-1',
        );

        expect(prismaStub.customer.updateMany).toHaveBeenCalledWith({
          where: { id: 'cust-1', shopId: 'shop-1' },
          data: { [field]: null },
        });
      },
    );

    it('normalises an updated phone to E.164', async () => {
      prismaStub.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.updateCustomer(
        'cust-1',
        { phone: '0300-999-8877' },
        'shop-1',
        'user-1',
      );

      expect(prismaStub.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', shopId: 'shop-1' },
        data: { phone: '923009998877' },
      });
    });
  });

  describe('deleteCustomer', () => {
    it('soft deletes instead of removing the row', async () => {
      prismaStub.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteCustomer('cust-1', 'shop-1', 'user-1');

      expect(prismaStub.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'cust-1', shopId: 'shop-1' },
        data: { isActive: false },
      });
    });

    it('throws 404 when the row is missing or owned by another shop', async () => {
      prismaStub.customer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.deleteCustomer('missing-id', 'shop-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCustomerLedger — WF11', () => {
    const saleRow = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id: 'sale-1',
      saleNo: 'S-0001',
      saleDate: new Date('2026-10-01T10:00:00.000Z'),
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      totalAmount: 10000000n,
      status: 'ACTIVE',
      notes: null,
      ...overrides,
    });

    const paymentRow = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id: 'pay-1',
      saleId: 'sale-1',
      amount: 4000000n,
      paymentDate: new Date('2026-10-02T12:00:00.000Z'),
      createdAt: new Date('2026-10-02T12:00:00.000Z'),
      status: 'ACTIVE',
      notes: null,
      ...overrides,
    });

    beforeEach(() => {
      prismaStub.customer.findFirst.mockResolvedValue({
        id: 'cust-1',
        name: 'Ali Khan',
        openingBalance: BigInt(5000000),
      });
      prismaStub.sale.findMany.mockResolvedValue([
        saleRow(),
        saleRow({
          id: 'sale-2',
          saleNo: 'S-0002',
          saleDate: new Date('2026-10-03T10:00:00.000Z'),
          createdAt: new Date('2026-10-03T10:00:00.000Z'),
          totalAmount: 8000000n,
          status: 'CANCELLED',
        }),
      ]);
      prismaStub.payment.findMany.mockResolvedValue([
        paymentRow(),
        paymentRow({
          id: 'pay-2',
          saleId: null,
          amount: 1000000n,
          paymentDate: new Date('2026-10-04T12:00:00.000Z'),
          createdAt: new Date('2026-10-04T12:00:00.000Z'),
          status: 'CANCELLED',
        }),
      ]);
      prismaStub.saleReturn.findMany.mockResolvedValue([]);
    });

    it('404s when the customer belongs to another shop', async () => {
      prismaStub.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.getCustomerLedger('cust-1', {}, 'shop-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.sale.findMany).not.toHaveBeenCalled();
    });

    it('scopes every query to the customer and the shop from the JWT', async () => {
      await service.getCustomerLedger('cust-1', {}, 'shop-1');

      expect(prismaStub.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: 'shop-1', customerId: 'cust-1' },
        }),
      );
      expect(prismaStub.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: 'shop-1', customerId: 'cust-1' },
        }),
      );
      expect(prismaStub.saleReturn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: 'shop-1', customerId: 'cust-1' },
        }),
      );
    });

    it('counts only ACTIVE rows but keeps cancelled ones visible', async () => {
      const res = await service.getCustomerLedger('cust-1', {}, 'shop-1');

      // 50000 opening + 100000 sale − 40000 payment; cancelled rows add 0.
      expect(res.openingBalance).toBe(5000000);
      expect(res.balance).toBe(11000000);
      expect(res.total).toBe(4);

      expect(res.items.map((e) => e.type)).toEqual([
        'SALE',
        'PAYMENT',
        'SALE',
        'PAYMENT',
      ]);
      expect(res.items.map((e) => e.delta)).toEqual([10000000, -4000000, 0, 0]);
      expect(res.items.map((e) => e.status)).toEqual([
        'ACTIVE',
        'ACTIVE',
        'CANCELLED',
        'CANCELLED',
      ]);
      expect(res.items.map((e) => e.balance)).toEqual([
        15000000, 11000000, 11000000, 11000000,
      ]);
    });

    it('sorts oldest first and resolves the sale each payment paid', async () => {
      const res = await service.getCustomerLedger('cust-1', {}, 'shop-1');

      expect(res.items.map((e) => e.date)).toEqual([
        '2026-10-01T10:00:00.000Z',
        '2026-10-02T12:00:00.000Z',
        '2026-10-03T10:00:00.000Z',
        '2026-10-04T12:00:00.000Z',
      ]);
      expect(res.items.map((e) => e.reference)).toEqual([
        'S-0001',
        'S-0001',
        'S-0002',
        null, // pay-2 has no saleId → it paid the opening balance
      ]);
    });

    it('lists returns and refunds against the sale with the right deltas (WF15)', async () => {
      prismaStub.saleReturn.findMany.mockResolvedValue([
        {
          id: 'ret-1',
          saleId: 'sale-1',
          returnDate: new Date('2026-10-05T11:00:00.000Z'),
          createdAt: new Date('2026-10-05T11:00:00.000Z'),
          returnAmount: 3000000n,
          status: 'ACTIVE',
          reason: 'Wrong charger',
          refunds: [
            {
              id: 'ref-1',
              amount: 1000000n,
              refundDate: new Date('2026-10-06T09:00:00.000Z'),
              createdAt: new Date('2026-10-06T09:00:00.000Z'),
              notes: null,
            },
          ],
        },
      ]);

      const res = await service.getCustomerLedger('cust-1', {}, 'shop-1');

      expect(res.total).toBe(6);
      expect(res.items.map((e) => e.type)).toEqual([
        'SALE',
        'PAYMENT',
        'SALE',
        'PAYMENT',
        'RETURN',
        'REFUND',
      ]);
      expect(res.items.map((e) => e.delta)).toEqual([
        10000000, -4000000, 0, 0, -3000000, 1000000,
      ]);
      // Return falls back to the reason when the refund has no notes.
      expect(res.items[4].reference).toBe('S-0001');
      expect(res.items[4].notes).toBe('Wrong charger');
      expect(res.items[5].reference).toBe('S-0001');
      // Opening 5000000 + sale − payment − return + refund.
      expect(res.items[5].balance).toBe(9000000);
      expect(res.balance).toBe(9000000);
    });

    it('keeps the running balance right on later pages', async () => {
      const res = await service.getCustomerLedger(
        'cust-1',
        { page: 2, pageSize: 2 },
        'shop-1',
      );

      expect(res.page).toBe(2);
      expect(res.pageSize).toBe(2);
      expect(res.total).toBe(4);
      expect(res.items).toHaveLength(2);
      expect(res.items[0].type).toBe('SALE');
      expect(res.items[0].status).toBe('CANCELLED');
      // Still 11000000 — page 2 sees page 1's effect on the balance.
      expect(res.items.map((e) => e.balance)).toEqual([11000000, 11000000]);
    });
  });
});

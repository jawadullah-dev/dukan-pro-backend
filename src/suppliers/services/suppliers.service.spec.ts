import { Test, TestingModule } from '@nestjs/testing';
import { SuppliersService } from './suppliers.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

const SHOP_ID = 'shop-1';
const SUPPLIER_ID = '01924f0a-0000-7000-8000-0000000000a1';

const prismaStub = {
  supplier: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  purchase: { findMany: jest.fn() },
  supplierPayment: { findMany: jest.fn() },
};

function baseSupplierRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUPPLIER_ID,
    shopId: SHOP_ID,
    name: 'ABC Mobiles',
    phone: '923001234567',
    address: 'Hall Road',
    notes: null,
    openingBalance: 5000000n,
    isSystem: false,
    isActive: true,
    createdAt: new Date('2026-10-05T09:20:00.000Z'),
    updatedAt: new Date('2026-10-05T09:20:00.000Z'),
    ...overrides,
  };
}

function walkInSellerRow() {
  return baseSupplierRow({
    name: 'Walk-in seller',
    isSystem: true,
    phone: null,
    address: null,
    notes: null,
    openingBalance: 0n,
  });
}

describe('SuppliersService', () => {
  let service: SuppliersService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: prismaStub },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSupplier', () => {
    it('writes the row under the shop from the JWT and trims the name', async () => {
      prismaStub.supplier.create.mockResolvedValue({ id: SUPPLIER_ID });

      await service.createSupplier({ name: '  ABC Mobiles  ' }, SHOP_ID, 'u1');

      expect(prismaStub.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: SHOP_ID,
          name: 'ABC Mobiles',
        }),
      });
    });

    it('defaults openingBalance to 0 when the owner sends none', async () => {
      prismaStub.supplier.create.mockResolvedValue({ id: SUPPLIER_ID });

      await service.createSupplier({ name: 'ABC Mobiles' }, SHOP_ID, 'u1');

      expect(prismaStub.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ openingBalance: 0n }),
      });
    });

    it('stores openingBalance as BigInt paisa, never as a float', async () => {
      prismaStub.supplier.create.mockResolvedValue({ id: SUPPLIER_ID });

      await service.createSupplier(
        { name: 'ABC Mobiles', openingBalance: 5000000 },
        SHOP_ID,
        'u1',
      );

      expect(prismaStub.supplier.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ openingBalance: 5000000n }),
      });
    });

    it('never lets the client mark a new supplier as isSystem', async () => {
      prismaStub.supplier.create.mockResolvedValue({ id: SUPPLIER_ID });

      await service.createSupplier({ name: 'Sneaky' }, SHOP_ID, 'u1');

      const { data } = prismaStub.supplier.create.mock.calls[0][0];
      expect('isSystem' in data).toBe(false);
    });

    it('does not attempt a duplicate-name check, because names are not unique', async () => {
      prismaStub.supplier.create.mockResolvedValue({ id: SUPPLIER_ID });

      // Same name twice in a row is legal per ERD v2 page 6.
      await service.createSupplier({ name: 'ABC Mobiles' }, SHOP_ID, 'u1');
      await service.createSupplier({ name: 'ABC Mobiles' }, SHOP_ID, 'u1');

      expect(prismaStub.supplier.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('getSuppliers', () => {
    it('scopes every list query to the shop in the JWT', async () => {
      prismaStub.supplier.findMany.mockResolvedValue([]);
      prismaStub.supplier.count.mockResolvedValue(0);

      await service.getSuppliers({ page: 1, pageSize: 10 }, SHOP_ID);

      expect(prismaStub.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shopId: SHOP_ID } }),
      );
      expect(prismaStub.supplier.count).toHaveBeenCalledWith({
        where: { shopId: SHOP_ID },
      });
    });

    it('ANDs the search across name, phone and address without widening shop scope', async () => {
      prismaStub.supplier.findMany.mockResolvedValue([]);
      prismaStub.supplier.count.mockResolvedValue(0);

      await service.getSuppliers(
        { page: 1, pageSize: 10, search: '  abc ' },
        SHOP_ID,
      );

      const { where } = prismaStub.supplier.findMany.mock.calls[0][0];
      expect(where.shopId).toBe(SHOP_ID);
      expect(where.OR).toEqual([
        { name: { contains: 'abc', mode: 'insensitive' } },
        { phone: { contains: 'abc', mode: 'insensitive' } },
        { address: { contains: 'abc', mode: 'insensitive' } },
      ]);
    });

    it('also matches the canonical phone when the owner types a local number', async () => {
      prismaStub.supplier.findMany.mockResolvedValue([]);
      prismaStub.supplier.count.mockResolvedValue(0);

      await service.getSuppliers(
        { page: 1, pageSize: 10, search: '0300-1234567' },
        SHOP_ID,
      );

      const { where } = prismaStub.supplier.findMany.mock.calls[0][0];
      expect(where.OR).toEqual([
        { name: { contains: '0300-1234567', mode: 'insensitive' } },
        { phone: { contains: '0300-1234567', mode: 'insensitive' } },
        { address: { contains: '0300-1234567', mode: 'insensitive' } },
        { phone: { contains: '923001234567', mode: 'insensitive' } },
      ]);
      expect(where.shopId).toBe(SHOP_ID);
    });

    it('adds no extra branch when the search term is already canonical', async () => {
      prismaStub.supplier.findMany.mockResolvedValue([]);
      prismaStub.supplier.count.mockResolvedValue(0);

      await service.getSuppliers(
        { page: 1, pageSize: 10, search: '923001234567' },
        SHOP_ID,
      );

      const { where } = prismaStub.supplier.findMany.mock.calls[0][0];
      expect(where.OR).toHaveLength(3);
    });

    it('passes the isActive filter through', async () => {
      prismaStub.supplier.findMany.mockResolvedValue([]);
      prismaStub.supplier.count.mockResolvedValue(0);

      await service.getSuppliers(
        { page: 1, pageSize: 10, isActive: false },
        SHOP_ID,
      );

      expect(prismaStub.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: SHOP_ID, isActive: false },
        }),
      );
    });

    it('maps BigInt openingBalance to a plain number for JSON', async () => {
      prismaStub.supplier.findMany.mockResolvedValue([
        baseSupplierRow({ openingBalance: 5000000n }),
      ]);
      prismaStub.supplier.count.mockResolvedValue(1);

      const res = await service.getSuppliers(
        { page: 1, pageSize: 10 },
        SHOP_ID,
      );

      expect(res.items[0].openingBalance).toBe(5000000);
      expect(res.items[0].isSystem).toBe(false);
      expect(res.total).toBe(1);
    });
  });

  describe('getSupplierById', () => {
    it('finds the supplier scoped to the shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(baseSupplierRow());

      await service.getSupplierById(SUPPLIER_ID, SHOP_ID);

      expect(prismaStub.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID, shopId: SHOP_ID },
      });
    });

    it('returns 404 when the supplier belongs to another shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.getSupplierById(SUPPLIER_ID, SHOP_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSupplier', () => {
    it('returns 404 when no row matches the shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.updateSupplier(SUPPLIER_ID, { name: 'New' }, SHOP_ID, 'u1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaStub.supplier.update).not.toHaveBeenCalled();
    });

    it('renames an ordinary supplier', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(baseSupplierRow());
      prismaStub.supplier.update.mockResolvedValue({});

      await service.updateSupplier(
        SUPPLIER_ID,
        { name: 'ABC Mobiles (Peshawar)' },
        SHOP_ID,
        'u1',
      );

      expect(prismaStub.supplier.update).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID },
        data: { name: 'ABC Mobiles (Peshawar)' },
      });
    });

    it('sends openingBalance as BigInt on update', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(baseSupplierRow());
      prismaStub.supplier.update.mockResolvedValue({});

      await service.updateSupplier(
        SUPPLIER_ID,
        { openingBalance: 1234500 },
        SHOP_ID,
        'u1',
      );

      expect(prismaStub.supplier.update).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID },
        data: { openingBalance: 1234500n },
      });
    });

    it('blocks renaming the system Walk-in seller', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(walkInSellerRow());

      await expect(
        service.updateSupplier(
          SUPPLIER_ID,
          { name: 'Ali Mobile' },
          SHOP_ID,
          'u1',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.supplier.update).not.toHaveBeenCalled();
    });

    it('blocks deactivating the system Walk-in seller', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(walkInSellerRow());

      await expect(
        service.updateSupplier(SUPPLIER_ID, { isActive: false }, SHOP_ID, 'u1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.supplier.update).not.toHaveBeenCalled();
    });

    it('allows harmless edits on the Walk-in seller, such as notes', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(walkInSellerRow());
      prismaStub.supplier.update.mockResolvedValue({});

      await service.updateSupplier(
        SUPPLIER_ID,
        { notes: 'No returns on used phones' },
        SHOP_ID,
        'u1',
      );

      expect(prismaStub.supplier.update).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID },
        data: { notes: 'No returns on used phones' },
      });
    });

    it('allows re-sending the Walk-in seller name unchanged', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(walkInSellerRow());
      prismaStub.supplier.update.mockResolvedValue({});

      await service.updateSupplier(
        SUPPLIER_ID,
        { name: 'Walk-in seller' },
        SHOP_ID,
        'u1',
      );

      expect(prismaStub.supplier.update).toHaveBeenCalled();
    });

    it('short-circuits when no field actually changed', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(baseSupplierRow());

      const res = await service.updateSupplier(SUPPLIER_ID, {}, SHOP_ID, 'u1');

      expect(prismaStub.supplier.update).not.toHaveBeenCalled();
      expect(res.status).toBe(true);
    });
  });

  describe('deleteSupplier', () => {
    it('soft-deactivates a supplier owned by the shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(baseSupplierRow());
      prismaStub.supplier.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteSupplier(SUPPLIER_ID, SHOP_ID, 'u1');

      expect(prismaStub.supplier.updateMany).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID, shopId: SHOP_ID },
        data: { isActive: false },
      });
    });

    it('never issues a hard delete', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(baseSupplierRow());
      prismaStub.supplier.updateMany.mockResolvedValue({ count: 1 });

      // The stub deliberately exposes no delete/deleteMany: any hard delete
      // would throw here instead of reaching the assertion.
      await service.deleteSupplier(SUPPLIER_ID, SHOP_ID, 'u1');

      expect(Object.keys(prismaStub.supplier)).not.toContain('delete');
      expect(Object.keys(prismaStub.supplier)).not.toContain('deleteMany');
      expect(prismaStub.supplier.updateMany).toHaveBeenCalledTimes(1);
    });

    it('refuses to deactivate the system Walk-in seller', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(walkInSellerRow());

      await expect(
        service.deleteSupplier(SUPPLIER_ID, SHOP_ID, 'u1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaStub.supplier.updateMany).not.toHaveBeenCalled();
    });

    it('returns 404 when no row matches the shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteSupplier(SUPPLIER_ID, SHOP_ID, 'u1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaStub.supplier.updateMany).not.toHaveBeenCalled();
    });

    it('reads the row through the same shop scope it later writes', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(baseSupplierRow());
      prismaStub.supplier.updateMany.mockResolvedValue({ count: 1 });

      await service.deleteSupplier(SUPPLIER_ID, SHOP_ID, 'u1');

      expect(prismaStub.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: SUPPLIER_ID, shopId: SHOP_ID },
      });
    });
  });

  describe('getSupplierLedger — WF11', () => {
    const purchaseRow = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id: '01924f0a-0000-7000-8000-0000000000c1',
      purchaseNo: 'P-0001',
      purchaseDate: new Date('2026-10-01T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T08:00:00.000Z'),
      totalAmount: 19000000n,
      status: 'ACTIVE',
      notes: null,
      ...overrides,
    });

    const paymentRow = (
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      id: '01924f0a-0000-7000-8000-0000000000f1',
      purchaseId: '01924f0a-0000-7000-8000-0000000000c1',
      amount: 9000000n,
      paymentDate: new Date('2026-10-02T00:00:00.000Z'),
      createdAt: new Date('2026-10-02T09:00:00.000Z'),
      status: 'ACTIVE',
      notes: null,
      ...overrides,
    });

    beforeEach(() => {
      prismaStub.supplier.findFirst.mockResolvedValue({
        id: SUPPLIER_ID,
        name: 'ABC Mobiles',
        openingBalance: BigInt(5000000),
      });
      prismaStub.purchase.findMany.mockResolvedValue([
        purchaseRow(),
        purchaseRow({
          id: '01924f0a-0000-7000-8000-0000000000c2',
          purchaseNo: 'P-0002',
          purchaseDate: new Date('2026-10-03T00:00:00.000Z'),
          createdAt: new Date('2026-10-03T08:00:00.000Z'),
          totalAmount: 7000000n,
          status: 'CANCELLED',
        }),
      ]);
      prismaStub.supplierPayment.findMany.mockResolvedValue([
        paymentRow(),
        paymentRow({
          id: '01924f0a-0000-7000-8000-0000000000f2',
          purchaseId: null,
          amount: 1000000n,
          paymentDate: new Date('2026-10-04T00:00:00.000Z'),
          createdAt: new Date('2026-10-04T09:00:00.000Z'),
          status: 'CANCELLED',
        }),
      ]);
    });

    it('404s when the supplier belongs to another shop', async () => {
      prismaStub.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.getSupplierLedger(SUPPLIER_ID, {}, SHOP_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaStub.purchase.findMany).not.toHaveBeenCalled();
    });

    it('scopes both queries to the supplier and shop, skipping opening stock', async () => {
      await service.getSupplierLedger(SUPPLIER_ID, {}, SHOP_ID);

      expect(prismaStub.purchase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            shopId: SHOP_ID,
            supplierId: SUPPLIER_ID,
            isOpeningStock: false,
          },
        }),
      );
      expect(prismaStub.supplierPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { shopId: SHOP_ID, supplierId: SUPPLIER_ID },
        }),
      );
    });

    it('matches the payable derivation and keeps cancelled rows visible at 0', async () => {
      const res = await service.getSupplierLedger(SUPPLIER_ID, {}, SHOP_ID);

      // 50000 opening + 190000 purchase − 90000 payment; cancelled rows add 0.
      expect(res.supplierName).toBe('ABC Mobiles');
      expect(res.openingBalance).toBe(5000000);
      expect(res.balance).toBe(15000000);
      expect(res.total).toBe(4);
      expect(res.items.map((e) => e.delta)).toEqual([19000000, -9000000, 0, 0]);
      expect(res.items.map((e) => e.balance)).toEqual([
        24000000, 15000000, 15000000, 15000000,
      ]);
      expect(res.items.map((e) => e.date)).toEqual([
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
        '2026-10-04',
      ]);
      expect(res.items.map((e) => e.reference)).toEqual([
        'P-0001',
        'P-0001',
        'P-0002',
        null, // payment with no purchaseId paid the opening balance
      ]);
    });

    it('pages the timeline without breaking the running balance', async () => {
      const res = await service.getSupplierLedger(
        SUPPLIER_ID,
        { page: 2, pageSize: 3 },
        SHOP_ID,
      );

      expect(res.page).toBe(2);
      expect(res.total).toBe(4);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].type).toBe('SUPPLIER_PAYMENT');
      expect(res.items[0].delta).toBe(0);
      expect(res.items[0].balance).toBe(15000000);
    });
  });
});

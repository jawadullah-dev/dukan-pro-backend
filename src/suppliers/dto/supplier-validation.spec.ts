import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupplierDto } from './create-supplier.dto.js';
import { UpdateSupplierDto } from './update-supplier.dto.js';
import { SupplierQueryFilterDto } from './supplier-query.filter.js';

/** Mirrors the global ValidationPipe in main.ts. */
const pipeOptions = { whitelist: true, forbidNonWhitelisted: true } as const;

const validCreate = { name: 'ABC Mobiles' };

describe('Supplier DTO validation', () => {
  it('accepts a minimal valid supplier', async () => {
    const dto = plainToInstance(CreateSupplierDto, validCreate);

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
  });

  it('accepts a supplier with every optional field filled in', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      name: 'ABC Mobiles',
      phone: '03001234567',
      address: 'Hall Road, Lahore',
      notes: 'Only original chargers',
      openingBalance: 5000000,
      isActive: true,
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
  });

  it('trims the name before validating length', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      name: '   ',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'name' })]),
    );
  });

  it('rejects a one-character name', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      name: 'A',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'name' })]),
    );
  });

  it('rejects a negative openingBalance', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      openingBalance: -1,
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'openingBalance' }),
      ]),
    );
  });

  it('rejects a fractional openingBalance, because money is integer paisa', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      openingBalance: 99.5,
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'openingBalance' }),
      ]),
    );
  });

  it('never allows isSystem through on create — only onboarding sets it', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      isSystem: true,
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'isSystem' }),
      ]),
    );
  });

  it('never allows shopId through — it comes from the JWT', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      shopId: 'someone-elses-shop',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'shopId' })]),
    );
  });

  it('normalises a local Pakistani mobile to the canonical form', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      phone: '0300-1234567',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
    expect(dto.phone).toBe('923001234567');
  });

  it('keeps a phone number it does not recognise rather than rejecting it', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      phone: '042-1234567',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
    expect(dto.phone).toBe('0421234567');
  });

  it('rejects an empty phone when one is sent', async () => {
    const dto = plainToInstance(CreateSupplierDto, {
      ...validCreate,
      phone: '   ',
    });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'phone' })]),
    );
  });
});

describe('Supplier update DTO validation', () => {
  it('accepts an update with no fields at all', async () => {
    const dto = plainToInstance(UpdateSupplierDto, {});

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
  });

  it('rejects a negative openingBalance on update too', async () => {
    const dto = plainToInstance(UpdateSupplierDto, { openingBalance: -5 });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'openingBalance' }),
      ]),
    );
  });

  it('rejects a whitespace-only name on update', async () => {
    const dto = plainToInstance(UpdateSupplierDto, { name: '  ' });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'name' })]),
    );
  });

  it('rejects isSystem on update — a client can never promote its own row', async () => {
    const dto = plainToInstance(UpdateSupplierDto, { isSystem: true });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'isSystem' }),
      ]),
    );
  });
});

describe('Supplier query filter', () => {
  it('accepts an empty query and applies the documented defaults', async () => {
    const dto = plainToInstance(SupplierQueryFilterDto, {});

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(10);
    expect(dto.sortBy).toBe('createdAt');
    expect(dto.sortOrder).toBe('desc');
  });

  it('accepts isActive=true', async () => {
    const dto = plainToInstance(SupplierQueryFilterDto, { isActive: 'true' });

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
    expect(dto.isActive).toBe(true);
  });

  it('accepts isActive=false', async () => {
    const dto = plainToInstance(SupplierQueryFilterDto, { isActive: 'false' });

    await expect(validate(dto, pipeOptions)).resolves.toEqual([]);
    expect(dto.isActive).toBe(false);
  });

  it('throws 400 for an isActive value that is neither true nor false', () => {
    expect(() =>
      plainToInstance(SupplierQueryFilterDto, { isActive: 'yes' }),
    ).toThrow(BadRequestException);
  });

  it('rejects a field that is not sortable', async () => {
    const dto = plainToInstance(SupplierQueryFilterDto, { sortBy: 'password' });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'sortBy' })]),
    );
  });

  it('rejects a pageSize above the 100 cap', async () => {
    const dto = plainToInstance(SupplierQueryFilterDto, { pageSize: 500 });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'pageSize' }),
      ]),
    );
  });

  it('rejects page 0', async () => {
    const dto = plainToInstance(SupplierQueryFilterDto, { page: 0 });

    await expect(validate(dto, pipeOptions)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'page' })]),
    );
  });
});

import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto.js';
import { UpdateProductDto } from './update-product.dto.js';
import { ProductQueryFilterDto } from './product-query.filter.js';

const CATEGORY_ID = '01924f0a-0000-7000-8000-0000000000c1';
const BRAND_ID = '01924f0a-0000-7000-8000-0000000000b1';

const validCreate = {
  name: 'Galaxy A15',
  categoryId: CATEGORY_ID,
  brandId: BRAND_ID,
  trackingType: 'QUANTITY',
};

describe('Product DTO validation', () => {
  it('accepts a minimal valid product', async () => {
    const dto = plainToInstance(CreateProductDto, validCreate);

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('trims the name before validating length', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...validCreate,
      name: '   ',
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'name' })]),
    );
  });

  it('rejects an unknown trackingType', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...validCreate,
      trackingType: 'SOMEHOW',
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'trackingType' }),
      ]),
    );
  });

  it('rejects a categoryId that is not a UUID', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...validCreate,
      categoryId: 'not-a-uuid',
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'categoryId' }),
      ]),
    );
  });

  it('rejects a brandId that is not a UUID', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...validCreate,
      brandId: 'nope',
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'brandId' }),
      ]),
    );
  });

  it.each([
    ['negative price', { defaultSellingPrice: -1 }],
    ['negative purchase price', { defaultPurchasePrice: -1 }],
    ['negative threshold', { lowStockThreshold: -1 }],
    ['fractional price', { defaultSellingPrice: 10.5 }],
  ])('rejects %s', async (_label, patch) => {
    const dto = plainToInstance(CreateProductDto, { ...validCreate, ...patch });

    await expect(validate(dto)).resolves.not.toEqual([]);
  });

  it('accepts a large paisa amount as an integer', async () => {
    const dto = plainToInstance(CreateProductDto, {
      ...validCreate,
      defaultPurchasePrice: 4_500_000,
      defaultSellingPrice: 699_900,
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('accepts a update payload with no fields at all', async () => {
    const dto = plainToInstance(UpdateProductDto, {});

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('allows trackingType in an update payload', async () => {
    const dto = plainToInstance(UpdateProductDto, {
      trackingType: 'SERIALIZED',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a negative lowStockThreshold on update', async () => {
    const dto = plainToInstance(UpdateProductDto, { lowStockThreshold: -2 });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'lowStockThreshold' }),
      ]),
    );
  });

  it('rejects isActive values other than true or false on the list filter', () => {
    expect(() =>
      plainToInstance(ProductQueryFilterDto, { isActive: 'banana' }, {}),
    ).toThrow(BadRequestException);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('converts isActive=%s to boolean %s', (input, expected) => {
    const dto = plainToInstance(ProductQueryFilterDto, { isActive: input });

    expect(dto.isActive).toBe(expected);
  });

  it('rejects an unsupported sortBy field', async () => {
    const dto = plainToInstance(ProductQueryFilterDto, { sortBy: 'whatever' });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'sortBy' })]),
    );
  });
});

import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerQueryFilterDto } from './customer-query.filter.js';
import { CreateCustomerDto } from './create-customer.dto.js';
import { UpdateCustomerDto } from './update-customer.dto.js';

describe('Customer DTO validation', () => {
  it('rejects a name that is blank after trimming', async () => {
    const dto = plainToInstance(CreateCustomerDto, { name: '   ' });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'name' })]),
    );
  });

  it('rejects a negative opening balance', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: 'Ali Khan',
      openingBalance: -1,
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'openingBalance' }),
      ]),
    );
  });

  it('rejects a fractional opening balance', async () => {
    const dto = plainToInstance(CreateCustomerDto, {
      name: 'Ali Khan',
      openingBalance: 10.5,
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'openingBalance' }),
      ]),
    );
  });

  it('accepts a customer with only a name', async () => {
    const dto = plainToInstance(CreateCustomerDto, { name: 'Ali Khan' });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects isActive values other than true or false', () => {
    expect(() =>
      plainToInstance(
        CustomerQueryFilterDto,
        { isActive: 'banana' },
        { enableImplicitConversion: true },
      ),
    ).toThrow(BadRequestException);
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('converts isActive=%s to boolean %s', (input, expected) => {
    const dto = plainToInstance(
      CustomerQueryFilterDto,
      { isActive: input },
      { enableImplicitConversion: true },
    );

    expect(dto.isActive).toBe(expected);
  });

  it('lets a patch omit every field', async () => {
    const dto = plainToInstance(UpdateCustomerDto, {});

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('accepts an openingBalance correction on update', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { openingBalance: 7500000 });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a negative openingBalance on update', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { openingBalance: -1 });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'openingBalance' }),
      ]),
    );
  });

  it('rejects a fractional openingBalance on update', async () => {
    const dto = plainToInstance(UpdateCustomerDto, { openingBalance: 10.5 });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'openingBalance' }),
      ]),
    );
  });
});

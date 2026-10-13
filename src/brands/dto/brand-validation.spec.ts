import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BrandQueryFilterDto } from './brand-query.filter.js';
import { CreateBrandDto } from './create-brand.dto.js';

describe('Brand DTO validation', () => {
  it('rejects a name that is blank after trimming', async () => {
    const dto = plainToInstance(CreateBrandDto, { name: '   ' });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'name' })]),
    );
  });

  it('rejects isActive values other than true or false', () => {
    expect(() =>
      plainToInstance(
        BrandQueryFilterDto,
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
      BrandQueryFilterDto,
      { isActive: input },
      { enableImplicitConversion: true },
    );

    expect(dto.isActive).toBe(expected);
  });
});

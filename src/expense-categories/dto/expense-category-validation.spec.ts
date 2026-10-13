import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ExpenseCategoryQueryFilterDto } from './expense-category-query.filter.js';
import { CreateExpenseCategoryDto } from './create-expense-category.dto.js';

describe('Expense category DTO validation', () => {
  it('rejects a name that is blank after trimming', async () => {
    const dto = plainToInstance(CreateExpenseCategoryDto, { name: '   ' });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'name' })]),
    );
  });

  it('rejects isActive values other than true or false', () => {
    expect(() =>
      plainToInstance(
        ExpenseCategoryQueryFilterDto,
        { isActive: 'banana' },
        { enableImplicitConversion: true },
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects a sortBy field outside name, createdAt and updatedAt', async () => {
    const dto = plainToInstance(ExpenseCategoryQueryFilterDto, {
      sortBy: 'shopId',
    });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'sortBy' })]),
    );
  });

  it.each(['name', 'createdAt', 'updatedAt'])(
    'accepts sortBy=%s',
    async (sortBy) => {
      const dto = plainToInstance(ExpenseCategoryQueryFilterDto, { sortBy });

      const errors = await validate(dto);
      expect(errors.filter((error) => error.property === 'sortBy')).toEqual([]);
    },
  );

  it.each([
    ['true', true],
    ['false', false],
  ])('converts isActive=%s to boolean %s', (input, expected) => {
    const dto = plainToInstance(
      ExpenseCategoryQueryFilterDto,
      { isActive: input },
      { enableImplicitConversion: true },
    );

    expect(dto.isActive).toBe(expected);
  });
});

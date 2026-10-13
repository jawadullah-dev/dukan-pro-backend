import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DashboardQueryFilterDto } from './dashboard-query.filter.js';

describe('Dashboard DTO validation', () => {
  it('defaults to today when no period is sent', async () => {
    const dto = plainToInstance(DashboardQueryFilterDto, {});

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.period).toBe('today');
  });

  it('accepts period=today', async () => {
    const dto = plainToInstance(DashboardQueryFilterDto, {
      period: 'today',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects week — date ranges are Release 1.1', async () => {
    const dto = plainToInstance(DashboardQueryFilterDto, { period: 'week' });

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'period' })]),
    );
  });
});

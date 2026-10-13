import { businessDayRange, businessToday } from './date.helper.js';

describe('date.helper', () => {
  describe('businessToday', () => {
    it('returns the PKT calendar day, not the UTC day', () => {
      // 2026-10-06 22:30 UTC = 2026-10-07 03:30 PKT — still the owner's day.
      expect(businessToday(new Date('2026-10-06T22:30:00.000Z'))).toBe(
        '2026-10-07',
      );
    });

    it('crosses to the next day at PKT midnight, not UTC midnight', () => {
      // 2026-10-06 18:59 UTC = 2026-10-06 23:59 PKT — still the 6th.
      expect(businessToday(new Date('2026-10-06T18:59:00.000Z'))).toBe(
        '2026-10-06',
      );
      // 2026-10-06 19:00 UTC = 2026-10-07 00:00 PKT — the 7th begins.
      expect(businessToday(new Date('2026-10-06T19:00:00.000Z'))).toBe(
        '2026-10-07',
      );
    });
  });

  describe('businessDayRange', () => {
    it('spans PKT midnight to PKT midnight', () => {
      const { start, end } = businessDayRange('2026-10-07');

      expect(start.toISOString()).toBe('2026-10-06T19:00:00.000Z');
      expect(end.toISOString()).toBe('2026-10-07T19:00:00.000Z');
    });

    it('covers exactly the instants businessToday agrees with', () => {
      const { start, end } = businessDayRange('2026-10-07');

      // First and last millisecond of the PKT day.
      expect(businessToday(start)).toBe('2026-10-07');
      expect(businessToday(new Date(end.getTime() - 1))).toBe('2026-10-07');
      expect(businessToday(end)).toBe('2026-10-08');
    });
  });
});

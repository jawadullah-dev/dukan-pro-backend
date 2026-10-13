import { normalizePhone, normalizePhoneOrRaw } from './phone.helper.js';

describe('phone.helper', () => {
  describe('normalizePhone', () => {
    it.each([
      ['03001234567', '923001234567'],
      ['0300-1234567', '923001234567'],
      ['+923001234567', '923001234567'],
      ['923001234567', '923001234567'],
      ['+92 300 1234567', '923001234567'],
      ['0300 123 4567', '923001234567'],
    ])('normalises %s', (input, expected) => {
      expect(normalizePhone(input)).toBe(expected);
    });

    it.each([
      '12345',
      '0300123456',
      '030012345678',
      '04001234567',
      'not-a-phone',
      '',
      null,
      undefined,
    ])('rejects %s', (input) => {
      expect(normalizePhone(input as string)).toBeNull();
    });
  });

  describe('normalizePhoneOrRaw', () => {
    it('falls back to a separator-free string for unknown formats', () => {
      expect(normalizePhoneOrRaw('+44 20 7123 4567')).toBe('442071234567');
    });
  });
});

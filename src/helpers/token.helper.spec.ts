import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashesMatch,
  isWellFormedToken,
} from './token.helper.js';

describe('token.helper', () => {
  describe('generateOpaqueToken', () => {
    it('returns a 64 character hex token', () => {
      expect(generateOpaqueToken()).toMatch(/^[a-f0-9]{64}$/);
    });

    it('never repeats', () => {
      const tokens = new Set(
        Array.from({ length: 500 }, () => generateOpaqueToken()),
      );
      expect(tokens.size).toBe(500);
    });
  });

  describe('hashOpaqueToken', () => {
    it('is deterministic', () => {
      const token = generateOpaqueToken();
      expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    });

    it('is not the token itself', () => {
      const token = generateOpaqueToken();
      expect(hashOpaqueToken(token)).not.toBe(token);
    });
  });

  describe('hashesMatch', () => {
    it('is true for the same token', () => {
      const token = generateOpaqueToken();
      expect(hashesMatch(hashOpaqueToken(token), hashOpaqueToken(token))).toBe(
        true,
      );
    });

    it('is false for different tokens', () => {
      expect(
        hashesMatch(
          hashOpaqueToken(generateOpaqueToken()),
          hashOpaqueToken(generateOpaqueToken()),
        ),
      ).toBe(false);
    });

    it('is false for a length mismatch instead of throwing', () => {
      expect(hashesMatch(hashOpaqueToken(generateOpaqueToken()), 'abc')).toBe(
        false,
      );
    });
  });

  describe('isWellFormedToken', () => {
    it('accepts a generated token', () => {
      expect(isWellFormedToken(generateOpaqueToken())).toBe(true);
    });

    it.each(['short', 'Z'.repeat(64), '', null, undefined])(
      'rejects %s',
      (token) => {
        expect(isWellFormedToken(token as string)).toBe(false);
      },
    );
  });
});

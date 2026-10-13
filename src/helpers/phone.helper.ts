/**
 * Pakistani mobile numbers are the login identity for shop owners.
 *
 * The UI collects them in whatever shape the owner types ("0300-1234567",
 * "+92 300 1234567") but the DB stores one canonical form so that
 * `users.phone` stays a reliable unique login key.
 *
 * Canonical form = E.164 without the "+" and without separators:
 *   03001234567   -> 923001234567
 *   +92-300-1234567 -> 923001234567
 *   923001234567  -> 923001234567
 *
 * Anything that is not a plausible Pakistani mobile number returns null, and
 * the caller decides whether that is a validation error.
 */

// All Pakistani mobile operators use 03xx as the local prefix.
const LOCAL_PREFIX = /^03\d{9}$/;
const E164_PREFIX = /^923\d{9}$/;

/**
 * Reduce any accepted spelling of a Pakistani mobile number to the canonical
 * `923xxxxxxxxx` string. Returns null when the input cannot be one.
 */
export const normalizePhone = (
  input: string | null | undefined,
): string | null => {
  if (!input) return null;

  const digits = input.replace(/[\s\-().]/g, '').replace(/^\+/, '');

  if (E164_PREFIX.test(digits)) return digits;
  if (LOCAL_PREFIX.test(digits)) return `92${digits.slice(1)}`;

  return null;
};

/**
 * Same normalisation, but throws nothing and falls back to the trimmed input
 * when it is not a recognisable Pakistani number.
 *
 * Use this before writing to `users.phone` / `platform_admins.phone` so a
 * hand-typed international number still produces a stable login key, and use
 * normalizePhone() when you need to reject bad input.
 */
export const normalizePhoneOrRaw = (input: string): string =>
  normalizePhone(input) ?? input.replace(/[\s\-().]/g, '').replace(/^\+/, '');

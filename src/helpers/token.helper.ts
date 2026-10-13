import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Helpers for the one-time password-setup token.
 *
 * Why SHA-256 and not bcrypt: the token is 32 bytes of CSPRNG output, not a
 * human-chosen secret, so there is no dictionary to brute force. Hashing it
 * with bcrypt would only add latency to an unauthenticated endpoint, which is
 * exactly the shape of thing we do not want to make slow. Owner *passwords*
 * still use bcrypt — only this link token uses SHA-256.
 */

const TOKEN_BYTES = 32;
const HEX_TOKEN_LENGTH = TOKEN_BYTES * 2;

export const isWellFormedToken = (token: string | null | undefined): boolean =>
  typeof token === 'string' &&
  new RegExp(`^[a-f0-9]{${HEX_TOKEN_LENGTH}}$`).test(token);

/**
 * Mint a new token. Returns the PLAINTEXT token — this is the only moment it
 * exists, and the caller must put it in the link that gets sent to the owner.
 */
export const generateOpaqueToken = (): string =>
  randomBytes(TOKEN_BYTES).toString('hex');

/**
 * Deterministic hash stored in `users.password_setup_token_hash`.
 */
export const hashOpaqueToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Constant-time comparison of two token hashes. Used instead of `===` so that
 * a wrong setup token cannot be brute forced by measuring response time.
 */
export const hashesMatch = (
  storedHash: string,
  candidateHash: string,
): boolean => {
  const stored = Buffer.from(storedHash, 'hex');
  const candidate = Buffer.from(candidateHash, 'hex');

  if (stored.length !== candidate.length || stored.length === 0) {
    return false;
  }

  return timingSafeEqual(stored, candidate);
};

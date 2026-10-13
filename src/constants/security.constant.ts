/**
 * Values shared between the running app and the local seed script.
 *
 * The seed script cannot use AppConfigurationService — it runs outside Nest —
 * so this file is the single place both sides agree on. Change BCRYPT_ROUNDS
 * here and in the Joi schema together, or hashes written by one will stop
 * verifying against the other.
 */
export const BCRYPT_ROUNDS = 10;

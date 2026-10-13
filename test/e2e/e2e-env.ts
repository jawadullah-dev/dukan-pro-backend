/**
 * E2E isolation contract.
 *
 * Every e2e run gets its own database, derived from the configured one by
 * appending a suffix. The dev database is never touched: the whole point of a
 * full-stack suite is to seed, sell and cancel real rows, and doing that
 * against `dukan_pro` would corrupt whatever the owner was testing by hand.
 *
 * The derivation is pure (URL in, URL out) so `setup-env.ts` (per worker) and
 * `global-setup.ts` (once, before workers) always agree on the same address.
 */
export const E2E_DB_SUFFIX = '_e2e';

export const E2E_ADMIN_PHONE = '03009999999';
export const E2E_ADMIN_PASSWORD = 'E2eAdminPass1';
export const E2E_ADMIN_NAME = 'E2E Platform Admin';

export const E2E_OWNER_PASSWORD = 'E2eOwnerPass1';

export const toE2eDatabaseUrl = (url: string | undefined): string => {
  if (!url) throw new Error('DATABASE_URL is required for e2e tests');
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');
  if (!name.endsWith(E2E_DB_SUFFIX)) {
    parsed.pathname = `/${name}${E2E_DB_SUFFIX}`;
  }
  return parsed.toString();
};

/**
 * Store address (slug) derivation shared by onboarding (WF1) and the owner's
 * first settings PATCH (WF19). One algorithm for everybody: the DB backfill,
 * the code that creates a row later, and the admin rename must never produce
 * three different addresses for the same shop name.
 */

/** Store addresses nobody may claim (mirrors store_slug_reserved_chk). */
export const RESERVED_SLUGS = new Set([
  'www',
  'app',
  'api',
  'admin',
  'store',
  'stores',
  'static',
  'assets',
  'cdn',
  'mail',
  'support',
  'help',
  'dashboard',
  'login',
  'signup',
  'public',
  'status',
  'dukaan',
  'dukaanpro',
  'dukanpro',
]);

/**
 * slugify the shop name → lowercase letters/numbers with single hyphens.
 * Truncated to 34 chars (the DB allows 40, leaving room for "-2"-style
 * suffixes), falls back to shop-<first 6 id chars> for unusable names, and
 * dodges reserved words with a "-shop" suffix.
 */
export function storeSlugBase(name: string, shopId: string): string {
  const slugified =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34)
      .replace(/^-+|-+$/g, '') || '';
  const fallback = `shop-${shopId.replace(/-/g, '').slice(0, 6)}`;
  const base = slugified.length >= 3 ? slugified : fallback;
  return RESERVED_SLUGS.has(base) ? `${base}-shop` : base;
}

/** Walks base, base-2, base-3… until `isTaken` says the address is free. */
export async function nextFreeStoreSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  let candidate = base;
  let n = 2;
  for (;;) {
    if (!(await isTaken(candidate))) return candidate;
    candidate = `${base}-${n}`;
    n += 1;
  }
}

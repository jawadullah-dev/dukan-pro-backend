import { Injectable } from '@nestjs/common';
import { ShopStoreSettings } from '../../generated/prisma/client.js';

export type CachedStoreSettings = ShopStoreSettings;

/**
 * WF22 step 2 — the slug → settings lookup is cached for ~60 seconds so a
 * hot public link does not hit PostgreSQL on every scroll.
 *
 * Only the settings ROW is cached: shops.status is read fresh on every
 * request (a suspension must hide the store immediately), and every settings
 * write clears this cache (an OFF switch must hide it immediately too).
 */
@Injectable()
export class StoreCacheService {
  private readonly ttlMs = 60_000;
  private readonly entries = new Map<
    string,
    { value: CachedStoreSettings; expiresAt: number }
  >();

  get(slug: string): CachedStoreSettings | undefined {
    const entry = this.entries.get(slug);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(slug);
      return undefined;
    }
    return entry.value;
  }

  set(slug: string, value: CachedStoreSettings): void {
    this.entries.set(slug, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Called after ANY settings write (owner PATCH or admin slug change). */
  clear(): void {
    this.entries.clear();
  }
}

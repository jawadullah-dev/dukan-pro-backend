import { Prisma } from '../generated/prisma/client.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

/**
 * Best-effort list of the column(s) that collided, lower-cased.
 *
 * Prisma reports them differently depending on how the client connects:
 *   - classic engine: `meta.target` = ['shop_id', 'sku'] (or a bare string)
 *   - driver adapters (Prisma 7 + @prisma/adapter-pg): `meta.target` is ABSENT.
 *     The information only survives inside the nested Postgres error, at
 *     `meta.driverAdapterError.cause.constraint.index` = 'products_shop_id_sku_key'
 *
 * Returns [] when nothing can be determined, so callers must keep a fallback.
 */
export function uniqueViolationColumns(error: unknown): string[] {
  if (!isUniqueConstraintViolation(error)) return [];

  const meta = (error as { meta?: Record<string, unknown> }).meta;
  if (!meta) return [];

  const columns: string[] = [];

  const target = meta['target'];
  if (Array.isArray(target)) {
    columns.push(...target.map((c) => String(c).toLowerCase()));
  } else if (typeof target === 'string') {
    columns.push(target.toLowerCase());
  }

  const adapter = meta['driverAdapterError'] as
    { cause?: { constraint?: { index?: unknown } } } | undefined;
  const indexName = adapter?.cause?.constraint?.index;
  if (typeof indexName === 'string') {
    const withoutSuffix = indexName.replace(/_key$/, '').toLowerCase();
    // 'products_shop_id_sku' -> keep the whole thing AND the trailing column
    columns.push(withoutSuffix);
    const lastToken = withoutSuffix.split('_').pop();
    if (lastToken) columns.push(lastToken);
  }

  return [...new Set(columns)];
}

/**
 * True when the collision was on `column`, tolerating both the bare column
 * name ('sku') and the full index name ('products_shop_id_sku').
 */
export function violatedColumn(error: unknown, column: string): boolean {
  const needle = column.toLowerCase();
  return uniqueViolationColumns(error).some(
    (c) => c === needle || c.endsWith(`_${needle}`),
  );
}

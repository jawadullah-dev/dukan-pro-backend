/**
 * Calculate rows-to-skip for a Prisma findMany() given 1-based page number
 * and page size. Simple arithmetic but kept in one place so every list
 * service does it identically.
 */
export const getSkipNumber = (
  page: number | string,
  pageSize: number | string,
): number => {
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Number(pageSize) || 10);
  return (p - 1) * ps;
};

/**
 * Return safe numeric page and pageSize values clamped to sane defaults
 * so a controller can never pass NaN / 0 to a list service.
 */
export const normalizePagination = (
  page?: number | string | null,
  pageSize?: number | string | null,
  maxPageSize = 100,
): { page: number; pageSize: number } => {
  const p = Math.max(1, Number(page) || 1);
  let ps = Math.max(1, Number(pageSize) || 10);
  if (ps > maxPageSize) ps = maxPageSize;
  return { page: p, pageSize: ps };
};

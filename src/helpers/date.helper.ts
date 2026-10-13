/**
 * Business-date helpers. Every shop in this product is in Pakistan, and
 * "today" on the dashboard must mean the owner's day, not the server's UTC
 * day: a sale at 01:00 PKT is still yesterday in UTC. Pakistan has had no
 * DST since 2010, so a fixed +05:00 offset is exact.
 *
 * `date` columns (expenseDate, purchaseDate, paymentDate on supplier
 * payments) are owner-typed business dates and are compared as the plain
 * YYYY-MM-DD string; `timestamptz` columns (saleDate, paymentDate, …) are
 * compared with the UTC instants the business day starts and ends on.
 */

export const BUSINESS_TIME_ZONE = 'Asia/Karachi';
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

const businessDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's business date in the shop's timezone: 'YYYY-MM-DD'. */
export function businessToday(now: Date = new Date()): string {
  return businessDayFormatter.format(now);
}

/** UTC [start, end) of a business day, for filtering `timestamptz` columns. */
export function businessDayRange(date: string): { start: Date; end: Date } {
  const [year, month, day] = date.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day) - KARACHI_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Add `days` to a plain calendar date 'YYYY-MM-DD' (no timezone involved). */
export function shiftDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86400000);
  return shifted.toISOString().slice(0, 10);
}

export type ReportPeriod = 'today' | 'week' | 'month' | 'custom';

export interface PeriodRange {
  /** UTC instant for `timestamptz` gte — the business day's start in Karachi. */
  start: Date;
  /** UTC instant for `timestamptz` lt — the day after `to`. */
  end: Date;
  /** Applied start as a plain business date, inclusive. */
  from: string;
  /** Applied end as a plain business date, inclusive. */
  to: string;
}

/**
 * Resolve a WF18 report range, all in the Asia/Karachi business calendar.
 *
 * - `period: today` → the current business day.
 * - `period: week` → the Monday–Sunday week containing today.
 * - `period: month` → the 1st–last day of the current month.
 * - `custom` (or when `from`/`to` are passed at all) → the given range;
 *   a missing side defaults to the other side (a single-day range).
 *
 * `start/end` are UTC instants for `timestamptz` filters (saleDate,
 * returnDate…). `from`/`to` are plain dates for `date` columns
 * (expenseDate, purchaseDate) and for the range echoed back to the client.
 */
export function periodRange(
  period: ReportPeriod = 'today',
  from?: string,
  to?: string,
): PeriodRange {
  if (from || to) {
    const resolvedFrom = from ?? to!;
    const resolvedTo = to ?? from!;
    return {
      start: businessDayRange(resolvedFrom).start,
      end: businessDayRange(resolvedTo).end,
      from: resolvedFrom,
      to: resolvedTo,
    };
  }

  const today = businessToday();
  if (period === 'week') {
    const [year, month, day] = today.split('-').map(Number);
    // getUTCDay on the calendar pieces == the PKT weekday (the string is the
    // PKT date). 0 = Sunday. Monday = (dow + 6) % 7 days back.
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const monday = shiftDays(today, -((dow + 6) % 7));
    return {
      start: businessDayRange(monday).start,
      end: businessDayRange(shiftDays(monday, 7)).end,
      from: monday,
      to: shiftDays(monday, 6),
    };
  }

  if (period === 'month') {
    const [year, month] = today.split('-').map(Number);
    const first = `${year}-${String(month).padStart(2, '0')}-01`;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      start: businessDayRange(first).start,
      end: businessDayRange(shiftDays(first, daysInMonth)).end,
      from: first,
      to: shiftDays(first, daysInMonth - 1),
    };
  }

  return {
    start: businessDayRange(today).start,
    end: businessDayRange(today).end,
    from: today,
    to: today,
  };
}

/**
 * `gte`/`lt` Date pair for a `date` column (expenseDate, purchaseDate) over an
 * inclusive business-day range. `date` columns store the plain YYYY-MM-DD at
 * UTC midnight, so the range is [from, to + 1 day) at UTC midnight — never
 * `new Date(from)` alone, which would cut the day at UTC midnight.
 */
export function dateColumnRange(
  from: string,
  to: string,
): {
  gte: Date;
  lt: Date;
} {
  return {
    gte: new Date(`${from}T00:00:00.000Z`),
    lt: new Date(`${shiftDays(to, 1)}T00:00:00.000Z`),
  };
}

import { businessToday } from './date.helper.js';

/**
 * Minimal RFC 4180 CSV writer — WF18 export. Zero dependencies on purpose:
 * a report should never pull in a whole CSV package for one string builder.
 *
 * - Every field is quoted only when it needs to be (contains a comma, quote,
 *   newline or carriage return); internal double quotes are doubled.
 * - A UTF-8 BOM is prepended so Excel and Google Sheets open PKT rupees
 *   without mojibake.
 * - Money is formatted as rupees (paisa / 100, two decimals) for humans;
 *   the JSON API keeps paisa integers — only the CSV shows rupees.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

const needsQuoting = (value: string): boolean => /[",\r\n]/.test(value);

const escapeField = (value: string): string =>
  needsQuoting(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * Render rows into a CSV document string (BOM + header + rows).
 * Column order = the order of `columns`; header = the row headers.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => c.header).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeField(String(c.value(row) ?? ''))).join(','),
  );
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}

/** Paisa → '1,234.56' rupees (two decimals, thousands separators). */
export function formatRupees(paisa: bigint | number): string {
  const value = Number(paisa) / 100;
  return new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** PKT business date 'YYYY-MM-DD' from a timestamp, or a dash when null. */
export function formatBusinessDate(value: Date | null | undefined): string {
  if (!value) return '—';
  return businessToday(value);
}

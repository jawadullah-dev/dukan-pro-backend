/**
 * Starter lists copied into a brand new shop (WF1 step 3).
 *
 * These are COPIES, never shared rows. The workflows PDF is explicit about why:
 * "Copies (not shared rows) let every shop rename or deactivate its own lists
 * safely." A shared category row renamed by one shop would corrupt every other
 * shop's product list.
 *
 * Each shop gets its own rows with its own shop_id, so deactivating
 * "Accessories" in one shop leaves every other shop untouched.
 */

export const DEFAULT_CATEGORIES = [
  'Mobile Phones',
  'Accessories',
  'Chargers & Cables',
  'Cases & Covers',
  'Screen Guards',
  'Earphones',
  'Power Banks',
] as const;

/**
 * Deliberately EMPTY.
 *
 * Phone brands change weekly, and a seeded brand list goes stale the moment it
 * ships. Worse, a stale "Nokia" sitting in the dropdown leads an owner to file
 * a new phone under a dead brand. The owner types their own brands in seconds
 * (WF4), and an empty list costs nothing.
 */
export const DEFAULT_BRANDS: readonly string[] = [];

/**
 * From the workflows PDF, WF13: "Groups expenses (Rent, Electricity...)".
 * These are the running costs of a small shop, and unlike brands they do not
 * churn — so seeding them saves real typing.
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Internet',
  'Salary',
  'Transport',
  'Maintenance',
  'Marketing',
  'Other',
] as const;

/**
 * The one supplier every shop must have (WF6).
 *
 * Used phones are bought from walk-in sellers — someone walks in, hands over a
 * phone, takes cash, and leaves. There is no recurring supplier to record, so
 * the purchase is attributed to this placeholder row instead of inventing a
 * new supplier each time.
 *
 * `isSystem = true` protects it: the suppliers service rejects any rename or
 * deactivate, so purchases never point at a missing supplier.
 */
export const WALK_IN_SUPPLIER = {
  name: 'Walk-in seller',
  notes: 'Default supplier for used phones bought from walk-in sellers.',
  isSystem: true,
} as const;

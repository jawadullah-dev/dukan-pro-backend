-- =============================================================================
-- Dukaan Pro - constraints.sql  (custom migration, ERD v2)
--
-- Things Prisma cannot express: CHECK constraints, partial / expression indexes,
-- triggers and (later) Row Level Security.
--
-- How to use:
--   1. npx prisma migrate dev --name init                        (creates all tables)
--   2. npx prisma migrate dev --create-only --name constraints   (creates an empty migration)
--   3. Paste this whole file into the new migration.sql, then: npx prisma migrate dev
--
-- Table names below are the @@map names (snake_case, plural).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CHECK constraints
-- -----------------------------------------------------------------------------

-- shops
ALTER TABLE shops
  ADD CONSTRAINT shops_counters_chk CHECK (next_sale_no >= 1 AND next_purchase_no >= 1);

-- products
ALTER TABLE products
  ADD CONSTRAINT products_prices_chk CHECK (
    default_purchase_price >= 0 AND default_selling_price >= 0 AND low_stock_threshold >= 0);

-- suppliers / customers (opening balance = old dues / old Udhar, never negative)
ALTER TABLE suppliers ADD CONSTRAINT suppliers_opening_chk CHECK (opening_balance >= 0);
ALTER TABLE customers ADD CONSTRAINT customers_opening_chk CHECK (opening_balance >= 0);

-- purchases
ALTER TABLE purchases
  ADD CONSTRAINT purchases_total_chk  CHECK (total_amount >= 0),
  ADD CONSTRAINT purchases_cancel_chk CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND cancelled_by_id IS NOT NULL)
    OR (status = 'ACTIVE' AND cancelled_at IS NULL AND cancel_reason IS NULL AND cancelled_by_id IS NULL));

ALTER TABLE purchase_items
  ADD CONSTRAINT purchase_items_qty_chk   CHECK (quantity > 0),
  ADD CONSTRAINT purchase_items_cost_chk  CHECK (unit_cost >= 0 AND total_cost >= 0),
  ADD CONSTRAINT purchase_items_total_chk CHECK (total_cost = quantity::bigint * unit_cost);

-- supplier_payments
ALTER TABLE supplier_payments
  ADD CONSTRAINT supplier_payments_amount_chk CHECK (amount > 0),
  ADD CONSTRAINT supplier_payments_cancel_chk CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND cancelled_by_id IS NOT NULL)
    OR (status = 'ACTIVE' AND cancelled_at IS NULL AND cancel_reason IS NULL AND cancelled_by_id IS NULL));

-- inventory
ALTER TABLE inventory_units
  ADD CONSTRAINT inventory_units_cost_chk CHECK (unit_cost >= 0),
  ADD CONSTRAINT inventory_units_imei_chk CHECK (imei2 IS NULL OR imei1 <> imei2);

ALTER TABLE stock_levels                       -- no negative accessory stock, ever
  ADD CONSTRAINT stock_levels_qty_chk CHECK (quantity_on_hand >= 0 AND avg_unit_cost >= 0);

ALTER TABLE inventory_movements
  ADD CONSTRAINT inventory_movements_qty_chk CHECK (quantity_change <> 0),
  ADD CONSTRAINT inventory_movements_ref_chk CHECK (
    (reference_type IS NULL AND reference_id IS NULL) OR (reference_type IS NOT NULL AND reference_id IS NOT NULL));

-- sales
ALTER TABLE sales
  ADD CONSTRAINT sales_amounts_chk CHECK (
    subtotal >= 0 AND discount >= 0 AND discount <= subtotal AND total_amount = subtotal - discount),
  ADD CONSTRAINT sales_cancel_chk CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND cancelled_by_id IS NOT NULL)
    OR (status = 'ACTIVE' AND cancelled_at IS NULL AND cancel_reason IS NULL AND cancelled_by_id IS NULL));

ALTER TABLE sale_items
  ADD CONSTRAINT sale_items_qty_chk    CHECK (quantity > 0),
  ADD CONSTRAINT sale_items_money_chk  CHECK (unit_price >= 0 AND unit_cost >= 0 AND total >= 0),
  ADD CONSTRAINT sale_items_total_chk  CHECK (total = quantity::bigint * unit_price),
  ADD CONSTRAINT sale_items_serial_chk CHECK (inventory_unit_id IS NULL OR quantity = 1);  -- a phone line is exactly 1

-- payments
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_chk CHECK (amount > 0),
  ADD CONSTRAINT payments_who_chk    CHECK (sale_id IS NOT NULL OR customer_id IS NOT NULL), -- opening-balance payment needs a customer
  ADD CONSTRAINT payments_cancel_chk CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND cancelled_by_id IS NOT NULL)
    OR (status = 'ACTIVE' AND cancelled_at IS NULL AND cancel_reason IS NULL AND cancelled_by_id IS NULL));

-- expenses
ALTER TABLE expenses
  ADD CONSTRAINT expenses_amount_chk CHECK (amount > 0),
  ADD CONSTRAINT expenses_cancel_chk CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND cancelled_by_id IS NOT NULL)
    OR (status = 'ACTIVE' AND cancelled_at IS NULL AND cancel_reason IS NULL AND cancelled_by_id IS NULL));

-- cash ledger
ALTER TABLE cash_movements
  ADD CONSTRAINT cash_movements_amount_chk CHECK (amount > 0),
  ADD CONSTRAINT cash_movements_reversal_chk CHECK (
    (type = 'REVERSAL' AND reverses_movement_id IS NOT NULL)
    OR (type <> 'REVERSAL' AND reverses_movement_id IS NULL)),
  ADD CONSTRAINT cash_movements_ref_chk CHECK (
    (reference_type IS NULL AND reference_id IS NULL) OR (reference_type IS NOT NULL AND reference_id IS NOT NULL)),
  -- direction must match the type (REVERSAL and RECONCILIATION_ADJUSTMENT can go either way)
  ADD CONSTRAINT cash_movements_direction_chk CHECK (
    (type IN ('OPENING_CASH','CUSTOMER_PAYMENT','OWNER_INVESTMENT') AND direction = 'IN')
    OR (type IN ('SUPPLIER_PAYMENT','EXPENSE','REFUND','OWNER_WITHDRAWAL') AND direction = 'OUT')
    OR type IN ('REVERSAL','RECONCILIATION_ADJUSTMENT'));

-- Release 1.1 tables
ALTER TABLE returns
  ADD CONSTRAINT returns_amount_chk CHECK (return_amount >= 0),
  ADD CONSTRAINT returns_reason_chk CHECK (length(btrim(reason)) > 0);
ALTER TABLE return_items ADD CONSTRAINT return_items_qty_chk CHECK (quantity > 0);
ALTER TABLE refunds      ADD CONSTRAINT refunds_amount_chk   CHECK (amount > 0);
ALTER TABLE cash_reconciliations
  ADD CONSTRAINT cash_recon_amounts_chk CHECK (system_cash >= 0 AND counted_cash >= 0 AND difference = counted_cash - system_cash),
  ADD CONSTRAINT cash_recon_reason_chk  CHECK (difference = 0 OR (reason IS NOT NULL AND length(btrim(reason)) > 0));

-- -----------------------------------------------------------------------------
-- 2. Partial and expression indexes
-- -----------------------------------------------------------------------------

-- One OWNER per shop (MVP rule). Remove this index when you add more users/roles.
CREATE UNIQUE INDEX users_one_owner_per_shop ON users (shop_id) WHERE role = 'OWNER';

-- Double-save protection for payments. One request may create several payment rows
-- (an Udhar payment split across sales), so the key includes the sale. The all-zero
-- UUID stands for "opening balance" (sale_id IS NULL).
CREATE UNIQUE INDEX payments_idempotency_uq
  ON payments (shop_id, client_request_id, COALESCE(sale_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Fast dashboard / ledger queries that only look at live records
CREATE INDEX sales_active_date_idx      ON sales (shop_id, sale_date)           WHERE status = 'ACTIVE';
CREATE INDEX payments_active_date_idx   ON payments (shop_id, payment_date)     WHERE status = 'ACTIVE';
CREATE INDEX expenses_active_date_idx   ON expenses (shop_id, expense_date)     WHERE status = 'ACTIVE';
CREATE INDEX purchases_active_date_idx  ON purchases (shop_id, purchase_date)   WHERE status = 'ACTIVE';
CREATE INDEX units_in_stock_idx         ON inventory_units (shop_id, product_id) WHERE status = 'IN_STOCK';

-- -----------------------------------------------------------------------------
-- 3. Triggers
-- -----------------------------------------------------------------------------

-- 3a. An IMEI can appear only once per shop, across BOTH imei1 and imei2
--     (the Prisma unique constraints only cover imei1-vs-imei1 and imei2-vs-imei2).
CREATE OR REPLACE FUNCTION inventory_units_imei_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM inventory_units u
    WHERE u.shop_id = NEW.shop_id AND u.id <> NEW.id
      AND (u.imei1 IN (NEW.imei1, NEW.imei2) OR (u.imei2 IS NOT NULL AND u.imei2 IN (NEW.imei1, NEW.imei2)))
  ) THEN
    RAISE EXCEPTION 'IMEI already exists in this shop' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_units_imei_guard_trg
  BEFORE INSERT OR UPDATE OF imei1, imei2 ON inventory_units
  FOR EACH ROW EXECUTE FUNCTION inventory_units_imei_guard();

-- 3b. Append-only ledgers: stock history and cash history can never be changed or deleted.
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed (use a reversal / cancel instead)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER cash_movements_append_only
  BEFORE UPDATE OR DELETE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- 3c. No hard delete of business records. Cancel or deactivate instead.
--     Master data (categories, brands, expense categories) is deactivated with
--     is_active, so it is protected here too. (TRUNCATE does not fire row triggers,
--     so test databases can still be reset.)
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Deleting from % is not allowed (cancel or deactivate instead)', TG_TABLE_NAME
    USING ERRCODE = '42501';
END; $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shops','users','categories','brands','expense_categories',
    'products','suppliers','customers',
    'purchases','purchase_items','supplier_payments','inventory_units',
    'sales','sale_items','payments','expenses',
    'returns','return_items','refunds','cash_reconciliations'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_delete()',
      t || '_no_delete', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Row Level Security (OPTIONAL, for later - a second safety net)
--    Not enabled in the MVP. Your NestJS code filters by shop_id; RLS would make the
--    database refuse cross-shop reads even if a query forgets the filter.
--
--    Idea: on every request run   SET LOCAL app.current_shop_id = '<shop uuid>';
--    inside the Prisma transaction, and enable a policy per table. Example for sales:
--
--    ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE sales FORCE ROW LEVEL SECURITY;
--    CREATE POLICY sales_tenant_isolation ON sales
--      USING (shop_id = current_setting('app.current_shop_id', true)::uuid)
--      WITH CHECK (shop_id = current_setting('app.current_shop_id', true)::uuid);
--
--    Repeat for every table that has shop_id. The app must connect with a role that is
--    NOT the table owner / superuser, or RLS will be bypassed.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- RELEASE 1.2 : ONLINE STORE
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. shop_store_settings: slug, contact and URL rules
-- -----------------------------------------------------------------------------
ALTER TABLE shop_store_settings
  -- URL-safe slug: lowercase letters, numbers, single hyphens, 3-40 characters
  ADD CONSTRAINT store_slug_format_chk CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 40),
  -- names that would collide with your own subdomains or look official
  ADD CONSTRAINT store_slug_reserved_chk CHECK (
    slug <> ALL (ARRAY['www','app','api','admin','store','stores','static','assets','cdn','mail',
                       'support','help','dashboard','login','signup','public','status',
                       'dukaan','dukaanpro','dukanpro'])),
  ADD CONSTRAINT store_display_name_chk CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 100),
  -- WhatsApp number: digits only, with country code (e.g. 923001234567)
  ADD CONSTRAINT store_whatsapp_chk CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^[0-9]{10,15}$'),
  -- Only http(s) links: blocks javascript: and data: URLs that would be unsafe on a public page
  ADD CONSTRAINT store_urls_chk CHECK (
    (logo_url IS NULL        OR logo_url        ~* '^https?://') AND
    (banner_url IS NULL      OR banner_url      ~* '^https?://') AND
    (google_maps_url IS NULL OR google_maps_url ~* '^https?://') AND
    (facebook_url IS NULL    OR facebook_url    ~* '^https?://') AND
    (instagram_url IS NULL   OR instagram_url   ~* '^https?://'));

-- A store settings row is never deleted (turn the store off with is_enabled = false)
CREATE TRIGGER shop_store_settings_no_delete
  BEFORE DELETE ON shop_store_settings
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- -----------------------------------------------------------------------------
-- 2. product_images
-- -----------------------------------------------------------------------------
ALTER TABLE product_images
  -- WF21: photos are served on a public page, https only
  ADD CONSTRAINT product_images_url_chk  CHECK (url ~* '^https://'),
  ADD CONSTRAINT product_images_sort_chk CHECK (sort_order >= 0);

-- -----------------------------------------------------------------------------
-- 3. products: published_at is maintained by the database
--    (so the service only has to flip is_published)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION products_set_published_at() RETURNS trigger AS $$
BEGIN
  IF NEW.is_published AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  ELSIF NOT NEW.is_published THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER products_set_published_at_trg
  BEFORE INSERT OR UPDATE OF is_published ON products
  FOR EACH ROW EXECUTE FUNCTION products_set_published_at();

-- -----------------------------------------------------------------------------
-- 4. Fast public catalog: only live, published products, newest first
-- -----------------------------------------------------------------------------
CREATE INDEX products_public_catalog_idx
  ON products (shop_id, published_at DESC)
  WHERE is_published AND is_active;

-- Counting IN_STOCK phones per product already uses units_in_stock_idx (Release 1).

-- -----------------------------------------------------------------------------
-- 5. BACKFILL: give every EXISTING shop a (disabled) store row with a unique slug
--    Safe to run once. New shops get their row from the onboarding code instead.
-- -----------------------------------------------------------------------------
WITH base AS (
  SELECT s.id, s.name, s.phone, s.address, s.created_at,
         CASE
           WHEN b.slug_raw IS NULL OR char_length(b.slug_raw) < 3 THEN 'shop-' || left(replace(s.id::text,'-',''), 6)
           WHEN b.slug_raw IN ('www','app','api','admin','store','stores','static','assets','cdn','mail',
                               'support','help','dashboard','login','signup','public','status',
                               'dukaan','dukaanpro','dukanpro') THEN b.slug_raw || '-shop'
           ELSE b.slug_raw
         END AS slug_base
  FROM shops s
  CROSS JOIN LATERAL (
    SELECT NULLIF(btrim(left(btrim(regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g'), '-'), 34), '-'), '') AS slug_raw
  ) b
  WHERE NOT EXISTS (SELECT 1 FROM shop_store_settings x WHERE x.shop_id = s.id)
), numbered AS (
  SELECT *, row_number() OVER (PARTITION BY slug_base ORDER BY created_at, id) AS n FROM base
)
INSERT INTO shop_store_settings (shop_id, slug, is_enabled, display_name, phone_number, address, updated_at)
SELECT id,
       CASE WHEN n = 1 AND NOT EXISTS (SELECT 1 FROM shop_store_settings e WHERE e.slug = numbered.slug_base)
            THEN slug_base ELSE slug_base || '-' || n END,
       false,
       left(btrim(name), 100),
       NULLIF(regexp_replace(phone, '[^0-9]', '', 'g'), ''),
       address,
       now()
FROM numbered;
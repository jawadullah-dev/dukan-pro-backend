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
  ADD CONSTRAINT product_images_url_chk  CHECK (url ~* '^https?://'),
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
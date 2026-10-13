-- WF21: photos shown on the public storefront must be served over https.
-- Relax → tighten is deliberate: rewrite any legacy http:// row first, so the
-- new CHECK cannot fail and no image is silently dropped from a store page.
UPDATE product_images
SET url = 'https://' || substring(url from 8)
WHERE url ~* '^http://';

ALTER TABLE product_images
  DROP CONSTRAINT product_images_url_chk;

ALTER TABLE product_images
  ADD CONSTRAINT product_images_url_chk CHECK (url ~* '^https://');

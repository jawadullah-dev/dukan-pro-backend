\set ON_ERROR_STOP off
\set QUIET off
BEGIN;

-- helper: each negative test runs in its own savepoint so one failure
-- does not abort the whole verification transaction.
CREATE OR REPLACE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS text AS $$
DECLARE got text;
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RETURN label || ' -> BLOCKED (' || SQLSTATE || '): ' || left(SQLERRM, 90);
  END;
  RETURN label || ' -> !!! NOT BLOCKED !!!';
END; $$ LANGUAGE plpgsql;

INSERT INTO shops (id, name, subscription_ends_at, updated_at) VALUES ('11111111-1111-1111-1111-111111111111','Test Shop', now()+interval '1 year', now());
INSERT INTO users (id, shop_id, name, phone, updated_at) VALUES ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Owner','0300-0000000', now());
INSERT INTO categories (id, shop_id, name, updated_at) VALUES ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111','Phones', now());
INSERT INTO brands (id, shop_id, name, updated_at) VALUES ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111','Brand', now());
INSERT INTO expense_categories (id, shop_id, name, updated_at) VALUES ('5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a','11111111-1111-1111-1111-111111111111','Rent', now());
INSERT INTO customers (id, shop_id, name, updated_at) VALUES ('abababab-abab-abab-abab-abababababab','11111111-1111-1111-1111-111111111111','Cust', now());
INSERT INTO suppliers (id, shop_id, name, updated_at) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','11111111-1111-1111-1111-111111111111','Sup', now());
INSERT INTO products (id, shop_id, category_id, brand_id, name, tracking_type, updated_at)
  VALUES ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555','Charger','QUANTITY', now());

\echo '=== NEGATIVE TESTS (each line should say BLOCKED) ==='
SELECT pg_temp.expect_fail('T1  second OWNER in same shop',
  $$INSERT INTO users (id, shop_id, name, phone, role, updated_at) VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','O2','0300-1','OWNER', now())$$);

SELECT pg_temp.expect_fail('T2  negative stock on hand',
  $$INSERT INTO stock_levels (product_id, shop_id, quantity_on_hand, avg_unit_cost, updated_at) VALUES ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',-5,100, now())$$);

SELECT pg_temp.expect_fail('T3  sale total != subtotal - discount',
  $$INSERT INTO sales (id, shop_id, sale_no, sale_date, subtotal, discount, total_amount, client_request_id, created_by_id, updated_at) VALUES ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111','S-0001',now(),10000,500,9000,'88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222', now())$$);

SELECT pg_temp.expect_fail('T4  CUSTOMER_PAYMENT with direction OUT',
  $$INSERT INTO cash_movements (id, shop_id, type, direction, amount, movement_date, created_by_id) VALUES ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','CUSTOMER_PAYMENT','OUT',500,now(),'22222222-2222-2222-2222-222222222222')$$);

SELECT pg_temp.expect_fail('T5  inventory movement with quantity_change = 0',
  $$INSERT INTO inventory_movements (id, shop_id, product_id, type, quantity_change) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','ADJUSTMENT',0)$$);

SELECT pg_temp.expect_fail('T6  REVERSAL without reverses_movement_id',
  $$INSERT INTO cash_movements (id, shop_id, type, direction, amount, movement_date, created_by_id) VALUES ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','REVERSAL','IN',500,now(),'22222222-2222-2222-2222-222222222222')$$);

SELECT pg_temp.expect_fail('T7  CANCELLED sale with no cancelled_at / reason',
  $$INSERT INTO sales (id, shop_id, sale_no, sale_date, subtotal, discount, total_amount, status, client_request_id, created_by_id, updated_at) VALUES ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111','S-0001',now(),10000,0,10000,'CANCELLED','88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222', now())$$);

SELECT pg_temp.expect_fail('T8  phone line (inventory_unit_id) with quantity 2',
  $$INSERT INTO sale_items (id, shop_id, sale_id, product_id, inventory_unit_id, quantity, unit_price, unit_cost, total) VALUES ('1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a','11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777','66666666-6666-6666-6666-666666666666',gen_random_uuid(),2,1000,500,2000)$$);

SELECT pg_temp.expect_fail('T9  sale_item total != quantity * unit_price',
  $$INSERT INTO sale_items (id, shop_id, sale_id, product_id, quantity, unit_price, unit_cost, total) VALUES ('2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a2a2a','11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777','66666666-6666-6666-6666-666666666666',2,1000,500,2500)$$);

SELECT pg_temp.expect_fail('T10 payment with neither sale_id nor customer_id',
  $$INSERT INTO payments (id, shop_id, amount, payment_date, client_request_id, created_by_id, updated_at) VALUES ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd','11111111-1111-1111-1111-111111111111',100,now(),'13131313-1313-1313-1313-131313131313','22222222-2222-2222-2222-222222222222', now())$$);

SELECT pg_temp.expect_fail('T11 zero-amount expense',
  $$INSERT INTO expenses (id, shop_id, category_id, amount, expense_date, created_by_id, updated_at) VALUES ('3a3a3a3a-3a3a-3a3a-3a3a-3a3a3a3a3a3a','11111111-1111-1111-1111-111111111111','5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a',0,now(),'22222222-2222-2222-2222-222222222222', now())$$);

SELECT pg_temp.expect_fail('T12 negative customer opening balance',
  $$INSERT INTO customers (id, shop_id, name, opening_balance, updated_at) VALUES ('4a4a4a4a-4a4a-4a4a-4a4a-4a4a4a4a4a4a','11111111-1111-1111-1111-111111111111','Neg',-100, now())$$);

\echo ''
\echo '=== POSITIVE SETUP: these must all SUCCEED ==='
INSERT INTO stock_levels (product_id, shop_id, quantity_on_hand, avg_unit_cost, updated_at) VALUES ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',10,100, now());
INSERT INTO sales (id, shop_id, sale_no, sale_date, subtotal, discount, total_amount, client_request_id, created_by_id, updated_at) VALUES ('77777777-7777-7777-7777-777777777777','11111111-1111-1111-1111-111111111111','S-0001',now(),10000,500,9500,'88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222', now());
INSERT INTO sale_items (id, shop_id, sale_id, product_id, quantity, unit_price, unit_cost, total) VALUES ('2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a2a2a','11111111-1111-1111-1111-111111111111','77777777-7777-7777-7777-777777777777','66666666-6666-6666-6666-666666666666',2,1000,500,2000);
INSERT INTO cash_movements (id, shop_id, type, direction, amount, movement_date, created_by_id) VALUES ('99999999-9999-9999-9999-999999999999','11111111-1111-1111-1111-111111111111','CUSTOMER_PAYMENT','IN',500,now(),'22222222-2222-2222-2222-222222222222');
INSERT INTO inventory_movements (id, shop_id, product_id, type, quantity_change) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','PURCHASE',3);
INSERT INTO purchases (id, shop_id, supplier_id, purchase_no, purchase_date, total_amount, client_request_id, created_by_id, updated_at) VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','11111111-1111-1111-1111-111111111111','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','P-0001',now(),5000,'14141414-1414-1414-1414-141414141414','22222222-2222-2222-2222-222222222222', now());
INSERT INTO purchase_items (id, shop_id, purchase_id, product_id, quantity, unit_cost, total_cost) VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd','66666666-6666-6666-6666-666666666666',1,5000,5000);
UPDATE products SET tracking_type='SERIALIZED' WHERE id='66666666-6666-6666-6666-666666666666';
INSERT INTO inventory_units (id, shop_id, product_id, purchase_item_id, imei1, unit_cost, updated_at) VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','cccccccc-cccc-cccc-cccc-cccccccccccc','350000000000001',5000, now());
INSERT INTO payments (id, shop_id, customer_id, sale_id, amount, payment_date, client_request_id, created_by_id, updated_at) VALUES ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd','11111111-1111-1111-1111-111111111111','abababab-abab-abab-abab-abababababab','77777777-7777-7777-7777-777777777777',100,now(),'12121212-1212-1212-1212-121212121212','22222222-2222-2222-2222-222222222222', now());
\echo 'valid rows accepted OK'

\echo ''
\echo '=== NEGATIVE TESTS needing existing rows (triggers / indexes / deletes) ==='
SELECT pg_temp.expect_fail('T13 duplicate IMEI across imei1/imei2 (trigger)',
  $$INSERT INTO inventory_units (id, shop_id, product_id, purchase_item_id, imei1, imei2, unit_cost, updated_at) VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','cccccccc-cccc-cccc-cccc-cccccccccccc','999999999999999','350000000000001',5000, now())$$);

SELECT pg_temp.expect_fail('T14 DELETE on categories (master data, forbid_delete)',
  $$DELETE FROM categories WHERE id='44444444-4444-4444-4444-444444444444'$$);

SELECT pg_temp.expect_fail('T15 DELETE on users (forbid_delete)',
  $$DELETE FROM users WHERE id='22222222-2222-2222-2222-222222222222'$$);

SELECT pg_temp.expect_fail('T16 DELETE on shops (forbid_delete)',
  $$DELETE FROM shops WHERE id='11111111-1111-1111-1111-111111111111'$$);

SELECT pg_temp.expect_fail('T17 UPDATE on cash_movements (append-only)',
  $$UPDATE cash_movements SET amount = 1 WHERE id='99999999-9999-9999-9999-999999999999'$$);

SELECT pg_temp.expect_fail('T18 DELETE on cash_movements (append-only)',
  $$DELETE FROM cash_movements WHERE id='99999999-9999-9999-9999-999999999999'$$);

SELECT pg_temp.expect_fail('T19 DELETE on inventory_movements (append-only)',
  $$DELETE FROM inventory_movements WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$);

SELECT pg_temp.expect_fail('T20 duplicate payment idempotency key',
  $$INSERT INTO payments (id, shop_id, customer_id, sale_id, amount, payment_date, client_request_id, created_by_id, updated_at) VALUES ('5b5b5b5b-5b5b-5b5b-5b5b-5b5b5b5b5b5b','11111111-1111-1111-1111-111111111111','abababab-abab-abab-abab-abababababab','77777777-7777-7777-7777-777777777777',50,now(),'12121212-1212-1212-1212-121212121212','22222222-2222-2222-2222-222222222222', now())$$);

SELECT pg_temp.expect_fail('T21 sale total drift on UPDATE (sales_amounts_chk)',
  $$UPDATE sales SET total_amount = 1 WHERE id='77777777-7777-7777-7777-777777777777'$$);

ROLLBACK;
\echo 'rolled back (test data discarded)'

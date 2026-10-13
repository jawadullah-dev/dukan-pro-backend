import { UnitStatus } from '../../src/generated/prisma/enums.js';
import {
  createHarness,
  Harness,
  newRequestId,
  ProvisionedShop,
  businessToday,
} from './harness.js';

const IMEI = '356938035643809';

const createDefaults = async (shop: ProvisionedShop) => {
  const category = shop.api.get('/categories').query({ page: 1, pageSize: 1 });
  const [categories] = await Promise.all([category]);
  const categoryId = categories.body.data.items[0].id;

  const brandRes = await shop.api
    .post('/brands')
    .send({ name: `E2E Brand ${newRequestId()}` });
  expect(brandRes.status).toBe(201);
  const brandId = (
    await shop.api.get('/brands').query({ page: 1, pageSize: 1 })
  ).body.data.items[0].id;

  const supplierRes = await shop.api
    .get('/suppliers')
    .query({ page: 1, pageSize: 1 });
  const supplierId = supplierRes.body.data.items[0].id;

  const customerRes = await shop.api.post('/customers').send({
    name: 'Asad Tarar',
    phone: '03015551234',
  });
  expect(customerRes.status).toBe(201);
  const customerId = (
    await shop.api
      .get('/customers')
      .query({ search: 'Asad', page: 1, pageSize: 1 })
  ).body.data.items[0].id;

  return { categoryId, brandId, supplierId, customerId };
};

describe('E2E — full money loop (WF6/9/10/11/13/15/16/17/14)', () => {
  let harness: Harness;
  let shop: ProvisionedShop;
  let ids: Awaited<ReturnType<typeof createDefaults>>;

  beforeAll(async () => {
    harness = await createHarness();
    shop = await harness.provisionShop();
    ids = await createDefaults(shop);
  });

  afterAll(async () => {
    await harness.close();
  });

  let chargerId: string;
  let phoneId: string;
  let purchaseId: string;
  let saleId: string;
  let expenseId: string;
  let purchaseBody: Record<string, unknown>;
  let saleBody: Record<string, unknown>;

  it('sets opening cash and refuses a second opening', async () => {
    const res = await shop.api
      .post('/cash/opening')
      .send({ amount: 5_000_000 });
    expect(res.status).toBe(201);

    const again = await shop.api
      .post('/cash/opening')
      .send({ amount: 1_000_000 });
    expect(again.status).toBe(400);
  });

  it('creates charger (QUANTITY) and phone (SERIALIZED) products', async () => {
    const charger = await shop.api.post('/products').send({
      name: 'E2E Charger',
      categoryId: ids.categoryId,
      brandId: ids.brandId,
      trackingType: 'QUANTITY',
      sku: 'E2E-CHARGER',
      defaultPurchasePrice: 50_000,
      defaultSellingPrice: 80_000,
      lowStockThreshold: 2,
    });
    expect(charger.status).toBe(201);

    const phone = await shop.api.post('/products').send({
      name: 'E2E Phone',
      categoryId: ids.categoryId,
      brandId: ids.brandId,
      trackingType: 'SERIALIZED',
      sku: 'E2E-PHONE',
      defaultPurchasePrice: 5_000_000,
      defaultSellingPrice: 6_500_000,
      lowStockThreshold: 1,
    });
    expect(phone.status).toBe(201);

    chargerId = (
      await shop.api
        .get('/products')
        .query({ search: 'E2E Charger', page: 1, pageSize: 1 })
    ).body.data.items[0].id;
    phoneId = (
      await shop.api
        .get('/products')
        .query({ search: 'E2E Phone', page: 1, pageSize: 1 })
    ).body.data.items[0].id;
  });

  it('purchases 4 chargers + 1 phone with partial paidNow (WF6)', async () => {
    purchaseBody = {
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      supplierId: ids.supplierId,
      purchaseDate: businessToday(),
      paidNow: 1_000_000,
      items: [
        { productId: chargerId, quantity: 4, unitCost: 50_000 },
        { productId: phoneId, quantity: 1, unitCost: 5_000_000, imeis: [IMEI] },
      ],
    };
    const res = await shop.api.post('/purchases').send(purchaseBody);
    expect(res.status).toBe(201);

    const list = await shop.api
      .get('/purchases')
      .query({ page: 1, pageSize: 5 });
    const purchase = list.body.data.items[0];
    purchaseId = purchase.id;
    expect(purchase.purchaseNo).toBe('P-0001');
    expect(purchase.totalAmount).toBe(5_200_000);
    expect(purchase.supplierName).toBe('Walk-in seller');
    const phoneLine = purchase.items.find((i: any) => i.productId === phoneId);
    expect(phoneLine.imeis).toEqual([IMEI]);

    const tokens = await shop.api.get(`/purchases/${purchaseId}`);
    expect(tokens.status).toBe(200);
  });

  it('replaying the purchase clientRequestId is a silent success (no double stock)', async () => {
    const replay = await shop.api.post('/purchases').send(purchaseBody);
    expect(replay.status).toBe(201);

    const list = await shop.api
      .get('/purchases')
      .query({ page: 1, pageSize: 10 });
    expect(list.body.data.total).toBe(1);

    const charger = await shop.api.get(`/products/${chargerId}`);
    expect(charger.body.data.quantityOnHand).toBe(4);
  });

  it('stock landed: chargers 4 on hand, phone unit IN_STOCK', async () => {
    const [charger, phone] = await Promise.all([
      shop.api.get(`/products/${chargerId}`),
      shop.api.get(`/products/${phoneId}`),
    ]);
    expect(charger.body.data.quantityOnHand).toBe(4);
    expect(phone.body.data.quantityOnHand).toBe(1);
  });

  it('sells 1 phone + 2 chargers, part paid — Udhar is created (WF9)', async () => {
    const unit = await harness.prisma.inventoryUnit.findFirst({
      where: { shopId: shop.shopId, imei1: IMEI, status: UnitStatus.IN_STOCK },
    });
    expect(unit).not.toBeNull();

    saleBody = {
      clientRequestId: '22222222-2222-4222-8222-222222222222',
      customerId: ids.customerId,
      saleDate: businessToday(),
      paidNow: 2_000_000,
      items: [
        {
          productId: phoneId,
          inventoryUnitId: unit!.id,
          quantity: 1,
          unitPrice: 6_500_000,
        },
        { productId: chargerId, quantity: 2, unitPrice: 80_000 },
      ],
    };
    const res = await shop.api.post('/sales').send(saleBody);
    expect(res.status).toBe(201);

    const list = await shop.api.get('/sales').query({ page: 1, pageSize: 5 });
    const sale = list.body.data.items[0];
    saleId = sale.id;
    expect(sale.saleNo).toBe('S-0001');
    expect(sale.subtotal).toBe(6_660_000);
    expect(sale.totalAmount).toBe(6_660_000);
    expect(sale.payments[0].amount).toBe(2_000_000);
  });

  it('sale idempotency replay does not double-charge or double-decrement', async () => {
    const replay = await shop.api.post('/sales').send(saleBody);
    expect(replay.status).toBe(201);

    const replay2 = await shop.api.post('/sales').send(saleBody);
    expect(replay2.status).toBe(201);

    const list = await shop.api.get('/sales').query({ page: 1, pageSize: 10 });
    expect(list.body.data.total).toBe(1);

    const [charger, phone] = await Promise.all([
      shop.api.get(`/products/${chargerId}`),
      shop.api.get(`/products/${phoneId}`),
    ]);
    expect(charger.body.data.quantityOnHand).toBe(2);
    expect(phone.body.data.quantityOnHand).toBe(0);
  });

  it('customer pays Udhar, oldest-first allocation (WF10)', async () => {
    const res = await shop.api.post('/payments').send({
      clientRequestId: newRequestId(),
      customerId: ids.customerId,
      amount: 4_660_000,
      paymentDate: businessToday(),
    });
    expect(res.status).toBe(201);

    const overPay = await shop.api.post('/payments').send({
      clientRequestId: newRequestId(),
      customerId: ids.customerId,
      amount: 100,
      paymentDate: businessToday(),
    });
    expect(overPay.status).toBe(400);
  });

  it('returns the phone (GOOD) and refunds cash (WF15)', async () => {
    const sale = (await shop.api.get(`/sales/${saleId}`)).body.data;
    const phoneLine = sale.items.find((i: any) => i.productId === phoneId);
    expect(phoneLine.inventoryUnitId).toBeDefined();

    const preview = await shop.api
      .post(`/sales/${saleId}/returns/preview`)
      .send({
        items: [{ saleItemId: phoneLine.id, quantity: 1, condition: 'GOOD' }],
        refundAmount: 6_500_000,
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.returnAmount).toBe(6_500_000);
    expect(preview.body.data.refundable).toBe(6_500_000);
    expect(preview.body.data.outstandingBefore).toBe(0);

    const ret = await shop.api.post(`/sales/${saleId}/returns`).send({
      reason: 'Wrong color selected',
      returnDate: businessToday(),
      items: [{ saleItemId: phoneLine.id, quantity: 1, condition: 'GOOD' }],
      refundAmount: 6_500_000,
    });
    expect(ret.status).toBe(201);

    const phone = await shop.api.get(`/products/${phoneId}`);
    expect(phone.body.data.quantityOnHand).toBe(1);
  });

  it('a sale with an active return cannot be cancelled (WF12 guard)', async () => {
    const res = await shop.api.post(`/sales/${saleId}/cancel`).send({
      cancelReason: 'Should be blocked',
    });
    expect(res.status).toBe(400);
  });

  it('adds and cancels an expense — cash goes out then back (WF13)', async () => {
    const cat = (
      await shop.api.get('/expense-categories').query({ page: 1, pageSize: 5 })
    ).body.data.items[0];

    const created = await shop.api.post('/expenses').send({
      categoryId: cat.id,
      amount: 100_000,
      expenseDate: businessToday(),
    });
    expect(created.status).toBe(201);

    expenseId = (
      await shop.api.get('/expenses').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;

    const cancelled = await shop.api
      .post(`/expenses/${expenseId}/cancel`)
      .send({
        cancelReason: 'Billed twice',
      });
    expect(cancelled.status).toBe(201);
  });

  it('owner invests and withdraws cash (WF16)', async () => {
    const invest = await shop.api
      .post('/cash/investments')
      .send({ amount: 1_000_000 });
    expect(invest.status).toBe(201);

    const withdraw = await shop.api
      .post('/cash/withdrawals')
      .send({ amount: 500_000 });
    expect(withdraw.status).toBe(201);
  });

  it('reconciles matching cash (no movement) then a short count (WF17)', async () => {
    const matched = await shop.api.post('/cash-reconciliations').send({
      countedCash: 4_660_000,
    });
    expect(matched.status).toBe(201);

    const count = (
      await shop.api
        .get('/cash-reconciliations')
        .query({ page: 1, pageSize: 5 })
    ).body.data.items[0];
    expect(count.difference).toBe(0);

    const short = await shop.api.post('/cash-reconciliations').send({
      countedCash: 4_660_100,
      reason: 'Dashboard is outdated',
    });
    expect(short.status).toBe(201);
  });

  it('dashboard reflects the whole day (WF14)', async () => {
    const res = await shop.api.get('/dashboard').query({ period: 'today' });
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.todaySales).toBe(6_660_000);
    expect(data.todayNetProfit).toBe(6_660_000 - 5_100_000); // sales − (phone 5M + 2 chargers × 50k)
    expect(data.customerUdhar).toBe(0);
    expect(data.supplierPayable).toBe(4_200_000);
    expect(data.todayExpenses).toBe(0);
    expect(data.cashPosition).toBe(4_660_100);
    expect(data.links.todaySales).toContain('/sales?');
  });

  it('cash movements ledger shows every type', async () => {
    const res = await shop.api
      .get('/cash/movements')
      .query({ page: 1, pageSize: 50 });
    const types = res.body.data.items.map((m: any) => m.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'OPENING_CASH',
        'SUPPLIER_PAYMENT',
        'CUSTOMER_PAYMENT',
        'REFUND',
        'EXPENSE',
        'REVERSAL',
        'OWNER_INVESTMENT',
        'OWNER_WITHDRAWAL',
        'RECONCILIATION_ADJUSTMENT',
      ]),
    );
  });

  it('ledger endpoint reports the customer and supplier balances (WF11)', async () => {
    const [custLedger, supLedger] = await Promise.all([
      shop.api
        .get(`/customers/${ids.customerId}/ledger`)
        .query({ page: 1, pageSize: 50 }),
      shop.api
        .get(`/suppliers/${ids.supplierId}/ledger`)
        .query({ page: 1, pageSize: 50 }),
    ]);
    expect(custLedger.status).toBe(200);
    expect(custLedger.body.data.balance).toBe(0);
    expect(supLedger.status).toBe(200);
    expect(supLedger.body.data.balance).toBe(4_200_000);
  });

  it('GET /sales/:id returns the sale with items, payments and returns', async () => {
    const res = await shop.api.get(`/sales/${saleId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.returns).toHaveLength(1);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.payments).toHaveLength(2);
  });
});

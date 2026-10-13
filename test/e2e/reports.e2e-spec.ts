import {
  businessToday,
  createHarness,
  Harness,
  newRequestId,
  ProvisionedShop,
} from './harness.js';

const REPORTS = [
  'sales',
  'purchases',
  'expenses',
  'profit',
  'customers',
  'suppliers',
  'inventory',
  'best-sellers',
] as const;

describe('E2E — Reports + CSV export (WF18)', () => {
  let harness: Harness;
  let shop: ProvisionedShop;

  beforeAll(async () => {
    harness = await createHarness();
    shop = await harness.provisionShop();

    const categoryId = (
      await shop.api.get('/categories').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;
    const supplierId = (
      await shop.api.get('/suppliers').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;
    const brand = await shop.api
      .post('/brands')
      .send({ name: `Report Brand ${newRequestId()}` });
    expect(brand.status).toBe(201);
    const brandId = (
      await shop.api.get('/brands').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;
    const expenseCategoryId = (
      await shop.api.get('/expense-categories').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;

    await shop.api.post('/cash/opening').send({ amount: 20_000_000 });

    const customer = await shop.api
      .post('/customers')
      .send({ name: `Report Customer ${newRequestId()}` });
    expect(customer.status).toBe(201);
    const customerId = (
      await shop.api.get('/customers').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;

    const product = await shop.api.post('/products').send({
      name: `Report Charger ${newRequestId()}`,
      categoryId,
      brandId,
      trackingType: 'QUANTITY',
      sku: `REP-${newRequestId().slice(0, 8)}`,
      defaultPurchasePrice: 50_000,
      defaultSellingPrice: 80_000,
    });
    expect(product.status).toBe(201);
    const productId = (
      await shop.api.get('/products').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;

    const purchase = await shop.api.post('/purchases').send({
      clientRequestId: newRequestId(),
      supplierId,
      purchaseDate: businessToday(),
      paidNow: 100_000,
      items: [{ productId, quantity: 4, unitCost: 50_000 }],
    });
    expect(purchase.status).toBe(201);

    const sale = await shop.api.post('/sales').send({
      clientRequestId: newRequestId(),
      customerId,
      saleDate: businessToday(),
      paidNow: 100_000,
      items: [{ productId, quantity: 2, unitPrice: 80_000 }],
    });
    expect(sale.status).toBe(201);

    const expense = await shop.api.post('/expenses').send({
      categoryId: expenseCategoryId,
      expenseDate: businessToday(),
      amount: 300_000,
      description: 'Report rent',
    });
    expect(expense.status).toBe(201);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('every report answers 200 with the ReportPage envelope', async () => {
    for (const report of REPORTS) {
      const res = await shop.api
        .get(`/reports/${report}`)
        .query({ period: 'today', page: 1, pageSize: 20 });
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(typeof data.from).toBe('string');
      expect(typeof data.to).toBe('string');
      expect(Array.isArray(data.items)).toBe(true);
      expect(typeof data.total).toBe('number');
      expect(data.summary).toBeDefined();
    }
  });

  it('sales report totals the seeded sale and excludes nothing active', async () => {
    const res = await shop.api
      .get('/reports/sales')
      .query({ period: 'today', page: 1, pageSize: 20 });
    expect(res.status).toBe(200);
    expect(res.body.data.summary.count).toBe(1);
    expect(res.body.data.summary.sumSubtotal).toBe(160_000);
    expect(res.body.data.summary.sumTotalAmount).toBe(160_000);
    expect(res.body.data.summary.sumPaid).toBe(100_000);
    const row = res.body.data.items[0];
    expect(row.profit).toBe(60_000);
    expect(row.outstanding).toBe(60_000);
  });

  it('purchase report splits opening stock from real bills', async () => {
    const res = await shop.api
      .get('/reports/purchases')
      .query({ period: 'today', page: 1, pageSize: 20 });
    expect(res.status).toBe(200);
    expect(res.body.data.summary.countReal).toBe(1);
    expect(res.body.data.summary.countOpeningStock).toBe(0);
    expect(res.body.data.items[0].outstanding).toBe(100_000);
  });

  it('profit report folds the period into net profit', async () => {
    const res = await shop.api
      .get('/reports/profit')
      .query({ period: 'today' });
    expect(res.status).toBe(200);
    expect(res.body.data.summary.grossSales).toBe(160_000);
    expect(res.body.data.summary.cogs).toBe(100_000);
    expect(res.body.data.summary.expenses).toBe(300_000);
    expect(res.body.data.summary.netProfit).toBe(-240_000);
  });

  it('snapshot reports echo businessToday and ignore the range', async () => {
    for (const report of ['customers', 'suppliers', 'inventory'] as const) {
      const res = await shop.api
        .get(`/reports/${report}`)
        .query({ period: 'today' });
      expect(res.status).toBe(200);
      expect(res.body.data.from).toBe(businessToday());
      expect(res.body.data.to).toBe(businessToday());
    }
  });

  it('best-sellers ranks by quantity sold', async () => {
    const res = await shop.api
      .get('/reports/best-sellers')
      .query({ period: 'today' });
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].quantitySold).toBe(2);
    expect(res.body.data.summary.totalQuantitySold).toBe(2);
  });

  it('rejects an unknown period', async () => {
    const res = await shop.api
      .get('/reports/sales')
      .query({ period: 'yesterday' });
    expect(res.status).toBe(400);
  });

  it('rejects a reversed range and one longer than 366 days', async () => {
    const reversed = await shop.api
      .get('/reports/sales')
      .query({ from: '2026-10-10', to: '2026-10-01' });
    expect(reversed.status).toBe(400);

    const tooLong = await shop.api
      .get('/reports/sales')
      .query({ from: '2025-01-01', to: '2026-12-31' });
    expect(tooLong.status).toBe(400);
  });

  it('format=csv streams a text/csv attachment, format=pdf is a 400', async () => {
    const csv = await shop.api
      .get('/reports/sales')
      .query({ period: 'today', format: 'csv' });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(typeof csv.text).toBe('string');
    expect(csv.text.length).toBeGreaterThan(0);

    const pdf = await shop.api
      .get('/reports/sales')
      .query({ period: 'today', format: 'pdf' });
    expect(pdf.status).toBe(400);
  });
});

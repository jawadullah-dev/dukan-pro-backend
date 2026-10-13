import {
  createHarness,
  Harness,
  newRequestId,
  ProvisionedShop,
} from './harness.js';

interface ShopAssets {
  categoryId: string;
  brandId: string;
  productId: string;
  customerId: string;
  supplierId: string;
}

const seedAssets = async (shop: ProvisionedShop): Promise<ShopAssets> => {
  const categoryId = (
    await shop.api.get('/categories').query({ page: 1, pageSize: 1 })
  ).body.data.items[0].id;
  const supplierId = (
    await shop.api.get('/suppliers').query({ page: 1, pageSize: 1 })
  ).body.data.items[0].id;

  const brand = await shop.api
    .post('/brands')
    .send({ name: `Tenancy Brand ${newRequestId()}` });
  expect(brand.status).toBe(201);
  const brandId = (
    await shop.api.get('/brands').query({ page: 1, pageSize: 1 })
  ).body.data.items[0].id;

  const product = await shop.api.post('/products').send({
    name: `Tenancy Product ${newRequestId()}`,
    categoryId,
    brandId,
    trackingType: 'QUANTITY',
    sku: `TEN-${newRequestId().slice(0, 8)}`,
    defaultPurchasePrice: 10_000,
    defaultSellingPrice: 15_000,
  });
  expect(product.status).toBe(201);
  const productId = (
    await shop.api.get('/products').query({ page: 1, pageSize: 1 })
  ).body.data.items[0].id;

  const customer = await shop.api
    .post('/customers')
    .send({ name: `Tenancy Customer ${newRequestId()}` });
  expect(customer.status).toBe(201);
  const customerId = (
    await shop.api.get('/customers').query({ page: 1, pageSize: 1 })
  ).body.data.items[0].id;

  return { categoryId, brandId, productId, customerId, supplierId };
};

describe('E2E — multi-tenancy isolation', () => {
  let harness: Harness;
  let shopA: ProvisionedShop;
  let shopB: ProvisionedShop;
  let a: ShopAssets;

  beforeAll(async () => {
    harness = await createHarness();
    shopA = await harness.provisionShop();
    shopB = await harness.provisionShop();
    const bBrand = await shopB.api
      .post('/brands')
      .send({ name: `Tenancy Brand B ${newRequestId()}` });
    expect(bBrand.status).toBe(201);
    a = await seedAssets(shopA);
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('reading rows across shops returns 404', () => {
    it('blocks reading another shop category', async () => {
      expect((await shopA.api.get(`/categories/${a.categoryId}`)).status).toBe(
        200,
      );
      expect((await shopB.api.get(`/categories/${a.categoryId}`)).status).toBe(
        404,
      );
    });

    it('blocks reading another shop brand', async () => {
      expect((await shopB.api.get(`/brands/${a.brandId}`)).status).toBe(404);
    });

    it('blocks reading another shop product', async () => {
      expect((await shopB.api.get(`/products/${a.productId}`)).status).toBe(
        404,
      );
    });

    it('blocks reading another shop customer', async () => {
      expect((await shopB.api.get(`/customers/${a.customerId}`)).status).toBe(
        404,
      );
    });

    it('blocks reading another shop supplier', async () => {
      expect((await shopB.api.get(`/suppliers/${a.supplierId}`)).status).toBe(
        404,
      );
    });

    it('blocks reading another shop ledger', async () => {
      expect(
        (await shopB.api.get(`/customers/${a.customerId}/ledger`)).status,
      ).toBe(404);
      expect(
        (await shopB.api.get(`/suppliers/${a.supplierId}/ledger`)).status,
      ).toBe(404);
    });
  });

  describe('mutating rows across shops returns 404', () => {
    it('blocks patching another shop category', async () => {
      const res = await shopB.api
        .patch(`/categories/${a.categoryId}`)
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);
    });

    it('blocks patching another shop product', async () => {
      const res = await shopB.api
        .patch(`/products/${a.productId}`)
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);
    });

    it('blocks deactivating another shop customer', async () => {
      const res = await shopB.api.delete(`/customers/${a.customerId}`);
      expect(res.status).toBe(404);
    });
  });

  describe('cross-shop foreign keys are rejected', () => {
    it('refuses creating a product with another shop category', async () => {
      const ownBrand = (
        await shopB.api.get('/brands').query({ page: 1, pageSize: 1 })
      ).body.data.items[0].id;
      const res = await shopB.api.post('/products').send({
        name: `Cross Product ${newRequestId()}`,
        categoryId: a.categoryId,
        brandId: ownBrand,
        trackingType: 'QUANTITY',
      });
      expect(res.status).toBe(404);
    });

    it('refuses creating a product with another shop brand', async () => {
      const ownCategory = (
        await shopB.api.get('/categories').query({ page: 1, pageSize: 1 })
      ).body.data.items[0].id;
      const res = await shopB.api.post('/products').send({
        name: `Cross Brand Product ${newRequestId()}`,
        categoryId: ownCategory,
        brandId: a.brandId,
        trackingType: 'QUANTITY',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('sending shopId in the body is a hard 400', () => {
    it('rejects shopId on create', async () => {
      const res = await shopA.api
        .post('/categories')
        .send({ name: `Forbidden ${newRequestId()}`, shopId: shopB.shopId });
      expect(res.status).toBe(400);
    });

    it('rejects shopId on update', async () => {
      const res = await shopA.api
        .patch(`/categories/${a.categoryId}`)
        .send({ name: 'Renamed', shopId: shopB.shopId });
      expect(res.status).toBe(400);
    });
  });

  describe('lists never leak another shop', () => {
    it('category list is scoped to the caller shop', async () => {
      const listA = await shopA.api
        .get('/categories')
        .query({ page: 1, pageSize: 100 });
      const listB = await shopB.api
        .get('/categories')
        .query({ page: 1, pageSize: 100 });
      const idsA = new Set(
        listA.body.data.items.map((c: { id: string }) => c.id),
      );
      for (const item of listB.body.data.items) {
        expect(idsA.has(item.id)).toBe(false);
      }
    });

    it('product list is scoped to the caller shop', async () => {
      const listB = await shopB.api
        .get('/products')
        .query({ page: 1, pageSize: 100 });
      const idsB = listB.body.data.items.map((p: { id: string }) => p.id);
      expect(idsB).not.toContain(a.productId);
    });
  });
});

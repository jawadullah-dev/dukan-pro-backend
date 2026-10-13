import {
  createHarness,
  Harness,
  newRequestId,
  ProvisionedShop,
} from './harness.js';
import sharp from 'sharp';

describe('E2E — Online Store (R1.2)', () => {
  let harness: Harness;
  let shop: ProvisionedShop;
  let categoryId: string;
  let brandId: string;
  let slug: string;
  let productId: string;

  beforeAll(async () => {
    harness = await createHarness();
    shop = await harness.provisionShop();
    categoryId = (
      await shop.api.get('/categories').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;
    const brand = await shop.api
      .post('/brands')
      .send({ name: `Store Brand ${newRequestId()}` });
    expect(brand.status).toBe(201);
    brandId = (await shop.api.get('/brands').query({ page: 1, pageSize: 1 }))
      .body.data.items[0].id;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('onboarding created a disabled store settings row', async () => {
    const res = await shop.api.get('/store/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.isEnabled).toBe(false);
    expect(typeof res.body.data.slug).toBe('string');
    expect(res.body.data.slug.length).toBeGreaterThan(0);
    slug = res.body.data.slug;
  });

  it('null displayName is a 400, the owner cannot change the slug', async () => {
    const nullName = await shop.api
      .patch('/store/settings')
      .send({ displayName: null });
    expect(nullName.status).toBe(400);

    const slugAttempt = await shop.api
      .patch('/store/settings')
      .send({ slug: 'hijack-my-store' });
    expect(slugAttempt.status).toBe(400);
  });

  it('creates a product and publishes it', async () => {
    const product = await shop.api.post('/products').send({
      name: `Store Phone ${newRequestId()}`,
      categoryId,
      brandId,
      trackingType: 'QUANTITY',
      sku: `STORE-${newRequestId().slice(0, 8)}`,
      defaultSellingPrice: 4_500_000,
    });
    expect(product.status).toBe(201);

    productId = (
      await shop.api.get('/products').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;

    const patch = await shop.api
      .patch(`/products/${productId}`)
      .send({ contactForPrice: true });
    expect(patch.status).toBe(200);

    const publish = await shop.api.post(`/store/products/${productId}/publish`);
    expect(publish.status).toBe(201);
  });

  it('refuses publishing an inactive product', async () => {
    const inactive = await shop.api.post('/products').send({
      name: `Inactive Store Phone ${newRequestId()}`,
      categoryId,
      brandId,
      trackingType: 'QUANTITY',
      isActive: false,
    });
    expect(inactive.status).toBe(201);
    const inactiveId = (
      await shop.api
        .get('/products')
        .query({ page: 1, pageSize: 1, isActive: false })
    ).body.data.items[0].id;

    const res = await shop.api.post(`/store/products/${inactiveId}/publish`);
    expect(res.status).toBe(400);
  });

  it('refuses bulk publish with a foreign product id', async () => {
    const other = await harness.provisionShop();
    const otherCategory = (
      await other.api.get('/categories').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;
    await other.api
      .post('/brands')
      .send({ name: `Foreign Brand ${newRequestId()}` });
    const otherBrand = (
      await other.api.get('/brands').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;
    const otherProduct = await other.api.post('/products').send({
      name: `Foreign ${newRequestId()}`,
      categoryId: otherCategory,
      brandId: otherBrand,
      trackingType: 'QUANTITY',
    });
    expect(otherProduct.status).toBe(201);
    const foreignId = (
      await other.api.get('/products').query({ page: 1, pageSize: 1 })
    ).body.data.items[0].id;

    const res = await shop.api
      .patch('/products/publish')
      .send({ ids: [foreignId], isPublished: true });
    expect(res.status).toBe(404);
  });

  it('uploads a product photo (multipart) and lists it', async () => {
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();

    const ok = await shop.api
      .post(`/products/${productId}/images`)
      .attach('image', png, {
        filename: 'photo.png',
        contentType: 'image/png',
      });
    expect(ok.status).toBe(201);

    const list = await shop.api.get(`/products/${productId}/images`);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].url).toMatch(/^https:\/\//);
    expect(list.body.data.items[0].sortOrder).toBe(0);
  });

  it('rejects a file that is not a real image', async () => {
    const bad = await shop.api
      .post(`/products/${productId}/images`)
      .attach('image', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      });
    expect(bad.status).toBe(400);
  });

  it('public store is a 404 while disabled, unknown slug is identical', async () => {
    const off = await shop.api.get(`/public/stores/${slug}`);
    expect(off.status).toBe(404);

    const unknown = await shop.api.get('/public/stores/zzz-no-such-store-xyz');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe(off.body.error);
    expect(unknown.body.message).toEqual(off.body.message);
  });

  it('owner preview still works while the store is OFF', async () => {
    const preview = await shop.api.get('/store/preview');
    expect(preview.status).toBe(200);
    expect(preview.body.data.slug).toBe(slug);

    const products = await shop.api.get('/store/preview/products');
    expect(products.status).toBe(200);
    expect(products.body.data.items.length).toBeGreaterThan(0);
  });

  it('enabling the store exposes the public profile + catalog', async () => {
    const enable = await shop.api.patch('/store/settings').send({
      isEnabled: true,
      displayName: 'E2E Store',
      whatsappNumber: '923001234567',
      city: 'Karachi',
      showExactStock: true,
    });
    expect(enable.status).toBe(200);

    const profile = await shop.api.get(`/public/stores/${slug}`);
    expect(profile.status).toBe(200);
    expect(profile.body.data.displayName).toBe('E2E Store');
    expect(profile.body.data.shopId).toBeUndefined();
    expect(profile.body.data.isEnabled).toBeUndefined();
    expect(profile.body.data.showExactStock).toBeUndefined();

    const catalog = await shop.api.get(`/public/stores/${slug}/products`);
    expect(catalog.status).toBe(200);
    const row = catalog.body.data.items.find(
      (p: { id: string }) => p.id === productId,
    );
    expect(row).toBeDefined();
    expect(row.shopId).toBeUndefined();
    expect(row.sku).toBeUndefined();
    expect(row.trackingType).toBeUndefined();
    expect(row.condition).toBeUndefined();
    expect(row.contactForPrice).toBe(true);
    expect(row.price).toBeNull();
    expect(typeof row.stockCount).toBe('number');

    const one = await shop.api.get(
      `/public/stores/${slug}/products/${productId}`,
    );
    expect(one.status).toBe(200);
  });
});

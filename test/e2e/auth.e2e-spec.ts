import request from 'supertest';
import { createHarness, Harness } from './harness.js';
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMIN_PHONE,
  E2E_OWNER_PASSWORD,
} from './e2e-env.js';

describe('E2E — onboarding & auth lifecycle (WF1/WF2/WF3)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('platform admin can log in and receives no shopId', async () => {
    const res = await request(harness.app.getHttpServer())
      .post('/auth/platform-admin/login')
      .send({ phone: E2E_ADMIN_PHONE, password: E2E_ADMIN_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.shopId).toBeUndefined();
  });

  it('rejects a wrong platform-admin password with 401', async () => {
    const res = await request(harness.app.getHttpServer())
      .post('/auth/platform-admin/login')
      .send({ phone: E2E_ADMIN_PHONE, password: 'WrongPass123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('onboards a shop with copied defaults in one call', async () => {
    const ownerPhone = '03009876543';
    const res = await harness.adminApi.post('/platform-admin/shops').send({
      shopName: 'Khalid Mobile Center',
      shopPhone: '03001112223',
      shopAddress: 'Main Bazaar, Lahore',
      subscriptionEndsAt: '2027-12-31',
      ownerName: 'Khalid Mehmood',
      ownerPhone,
    });

    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data.shopId).toBeDefined();
    expect(data.ownerId).toBeDefined();
    expect(data.defaults).toEqual({
      categories: 7,
      brands: 0,
      expenseCategories: 8,
      suppliers: 1,
    });
    expect(new URL(data.setupUrl).searchParams.get('token')).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it('completes the setup-link → login → me → change-password journey', async () => {
    const shop = await harness.provisionShop();

    const me = await shop.api.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.shop.id).toBe(shop.shopId);

    const wrong = await shop.api.post('/auth/change-password').send({
      currentPassword: 'NotMyPassword1',
      newPassword: 'NewOwnerPass1',
    });
    expect(wrong.status).toBe(400);

    const changed = await shop.api.post('/auth/change-password').send({
      currentPassword: E2E_OWNER_PASSWORD,
      newPassword: 'NewOwnerPass1',
    });
    expect(changed.status).toBe(201);

    const relogin = await request(harness.app.getHttpServer())
      .post('/auth/login')
      .send({ phone: shop.ownerPhone, password: 'NewOwnerPass1' });
    expect(relogin.status).toBe(201);
    expect(relogin.body.data.shopId).toBe(shop.shopId);
  });

  it('rejects a reused setup token', async () => {
    const createRes = await harness.adminApi
      .post('/platform-admin/shops')
      .send({
        shopName: 'Reused Token Shop',
        ownerName: 'Token Owner',
        ownerPhone: '03007776655',
        subscriptionEndsAt: '2027-12-31',
      });
    const token = new URL(createRes.body.data.setupUrl).searchParams.get(
      'token',
    );

    const first = await request(harness.app.getHttpServer())
      .post('/auth/setup-password')
      .send({ token, password: E2E_OWNER_PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(harness.app.getHttpServer())
      .post('/auth/setup-password')
      .send({ token, password: E2E_OWNER_PASSWORD });
    expect(second.status).toBe(400);
  });

  it('refuses to log in before a password is set (identical 401)', async () => {
    const createRes = await harness.adminApi
      .post('/platform-admin/shops')
      .send({
        shopName: 'Unset Password Shop',
        ownerName: 'Pending Owner',
        ownerPhone: '03006665544',
        subscriptionEndsAt: '2027-12-31',
      });
    expect(createRes.status).toBe(201);

    const res = await request(harness.app.getHttpServer())
      .post('/auth/login')
      .send({ phone: '03006665544', password: E2E_OWNER_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Phone number or password is incorrect');
  });

  it('blocks login for a suspended shop with 403, not 401', async () => {
    const shop = await harness.provisionShop();

    const suspended = await harness.adminApi
      .patch(`/platform-admin/shops/${shop.shopId}/subscription`)
      .send({ isActive: false });
    expect(suspended.status).toBe(200);

    const res = await request(harness.app.getHttpServer())
      .post('/auth/login')
      .send({ phone: shop.ownerPhone, password: E2E_OWNER_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rejects an owner token on a platform-admin route and vice versa', async () => {
    const shop = await harness.provisionShop();

    const ownerOnAdmin = await shop.api.get(
      `/platform-admin/shops/${shop.shopId}`,
    );
    expect(ownerOnAdmin.status).toBe(401);

    const adminOnOwner = await harness.adminApi.get('/auth/me');
    expect(adminOnOwner.status).toBe(401);
  });

  it('hard-rejects a shopId in the body (forbidNonWhitelisted)', async () => {
    const res = await request(harness.app.getHttpServer())
      .post('/auth/login')
      .send({
        phone: '03001234567',
        password: E2E_OWNER_PASSWORD,
        shopId: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBe(400);
  });
});

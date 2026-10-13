import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ClsService } from 'nestjs-cls';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TraceIdInterceptor } from '../../src/common/interceptors/trace-id.interceptor.js';
import { TraceLoggerService } from '../../src/common/logger/trace-logger.service.js';
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMIN_PHONE,
  E2E_OWNER_PASSWORD,
} from './e2e-env.js';

export interface Api {
  get(path: string): request.Test;
  post(path: string): request.Test;
  patch(path: string): request.Test;
  put(path: string): request.Test;
  delete(path: string): request.Test;
}

export interface ProvisionedShop {
  shopId: string;
  ownerId: string;
  ownerPhone: string;
  adminToken: string;
  ownerToken: string;
  api: Api;
  defaults: {
    categories: number;
    brands: number;
    expenseCategories: number;
    suppliers: number;
  };
}

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  adminApi: Api;
  adminToken: string;
  provisionShop(): Promise<ProvisionedShop>;
  close(): Promise<void>;
}

interface LoginData {
  accessToken: string;
  [key: string]: unknown;
}

/**
 * Boot the real application in-process, with the same global pipe and interceptor
 * wiring as `main.ts`. Supertest drives `app.getHttpServer()`, so no port is
 * opened and parallel spec files cannot collide on one.
 */
export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  const traceLogger = app.get(TraceLoggerService);
  const cls = app.get(ClsService);
  traceLogger.setClsService(cls);
  app.useLogger(traceLogger);

  app.useGlobalInterceptors(app.get(TraceIdInterceptor));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const server = app.getHttpServer();

  const api = (token?: string): Api => {
    const withAuth = (test: request.Test): request.Test =>
      token ? test.set('Authorization', `Bearer ${token}`) : test;
    return {
      get: (path) => withAuth(request(server).get(path)),
      post: (path) => withAuth(request(server).post(path)),
      patch: (path) => withAuth(request(server).patch(path)),
      put: (path) => withAuth(request(server).put(path)),
      delete: (path) => withAuth(request(server).delete(path)),
    };
  };

  const login = async (
    path: string,
    body: Record<string, unknown>,
  ): Promise<LoginData> => {
    const res = await request(server).post(path).send(body);
    if (res.status !== 200 && res.status !== 201) {
      throw new Error(
        `Login ${path} failed (${res.status}): ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.data as LoginData;
  };

  const adminToken = (
    await login('/auth/platform-admin/login', {
      phone: E2E_ADMIN_PHONE,
      password: E2E_ADMIN_PASSWORD,
    })
  ).accessToken;
  const adminApi = api(adminToken);

  let phoneCounter = Math.floor(Math.random() * 1000);

  const provisionShop = async (): Promise<ProvisionedShop> => {
    phoneCounter += 1;
    const ownerPhone = uniqueOwnerPhone(phoneCounter);

    const createRes = await adminApi.post('/platform-admin/shops').send({
      shopName: `E2E Shop ${ownerPhone}`,
      ownerName: 'E2E Owner',
      ownerPhone,
      subscriptionEndsAt: '2027-12-31',
    });
    if (createRes.status !== 201) {
      throw new Error(
        `createShop failed (${createRes.status}): ${JSON.stringify(createRes.body)}`,
      );
    }
    const created = createRes.body.data;
    const setupToken = new URL(created.setupUrl).searchParams.get('token');
    if (!setupToken) {
      throw new Error('createShop response carried no setup token');
    }

    const setupRes = await request(server)
      .post('/auth/setup-password')
      .send({ token: setupToken, password: E2E_OWNER_PASSWORD });
    if (setupRes.status >= 300) {
      throw new Error(
        `setup-password failed (${setupRes.status}): ${JSON.stringify(setupRes.body)}`,
      );
    }

    const ownerLogin = await login('/auth/login', {
      phone: ownerPhone,
      password: E2E_OWNER_PASSWORD,
    });

    return {
      shopId: created.shopId,
      ownerId: created.ownerId,
      ownerPhone,
      adminToken,
      ownerToken: ownerLogin.accessToken,
      api: api(ownerLogin.accessToken),
      defaults: created.defaults,
    };
  };

  return {
    app,
    prisma,
    adminApi,
    adminToken,
    provisionShop,
    close: async () => {
      await app.close();
    },
  };
}

const uniqueOwnerPhone = (counter: number): string => {
  const random = Math.floor(Math.random() * 1_000_000);
  const tail = `${counter}${random}`.padStart(6, '0').slice(-6);
  return `0300${tail}00`.slice(0, 11);
};

export const newRequestId = (): string => randomUUID();

/** The Asia/Karachi business day as `YYYY-MM-DD`. */
export const businessToday = (): string => {
  const now = new Date();
  const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return pkt.toISOString().slice(0, 10);
};

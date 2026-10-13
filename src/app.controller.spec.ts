import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppController } from './app.controller.js';

/**
 * Smoke test for the NestJS 12 upgrade. The v12 packages are ESM-only, so this
 * asserts that Jest on this Node version can require() them at all, which is
 * the documented failure mode (ERR_REQUIRE_ASYNC_MODULE on Node < 24.9).
 */
describe('AppController', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / reports the service is up', async () => {
    const body = (await request(server).get('/').expect(200)).body as unknown;

    expect(body).toMatchObject({
      status: 'ok',
      service: 'dukan-pro-backend',
    });
  });

  it('GET /health reports ok', async () => {
    const body = (await request(server).get('/health').expect(200)).body as {
      status: string;
    };

    expect(body.status).toBe('ok');
  });
});

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { ClsService } from 'nestjs-cls';
import { AppConfigurationService } from '../src/app-configuration/app-configuration.service.js';
import { AppModule } from '../src/app.module.js';
import { TraceIdInterceptor } from '../src/common/interceptors/trace-id.interceptor.js';
import { TraceLoggerService } from '../src/common/logger/trace-logger.service.js';

type NodeHandler = (req: Request, res: Response) => unknown;

let handler: NodeHandler | undefined;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

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

  const helmetMiddleware = helmet();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    return helmetMiddleware(req, res, next);
  });

  const configService = app.get(AppConfigurationService);
  app.enableCors({ origin: configService.corsOrigins, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle(configService.serverName)
    .setDescription(configService.serverDescription)
    .setVersion(configService.serverVersion)
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.init();
  return app.getHttpAdapter().getInstance() as (
    req: Request,
    res: Response,
  ) => unknown;
}

export default async (req: Request, res: Response) => {
  if (!handler) handler = await bootstrap();
  return handler(req, res);
};

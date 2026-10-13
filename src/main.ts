import net from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { ClsService } from 'nestjs-cls';
import { AppConfigurationService } from './app-configuration/app-configuration.service.js';
import { AppModule } from './app.module.js';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor.js';
import { TraceLoggerService } from './common/logger/trace-logger.service.js';

net.setDefaultAutoSelectFamily?.(false);

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Nest's Express adapter already parses JSON bodies. This flag only adds
    // `request.rawBody`, needed later for webhook signature verification.
    rawBody: true,
  });

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

  // Swagger UI ships inline scripts and styles that the default CSP blocks, so
  // /api is skipped. helmet only omits headers it is told to omit; mounting it
  // twice would not clear a header the global pass already set.
  const helmetMiddleware = helmet();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      return next();
    }
    return helmetMiddleware(req, res, next);
  });

  const configService = app.get(AppConfigurationService);

  app.enableCors({
    origin: configService.corsOrigins,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle(configService.serverName)
    .setDescription(configService.serverDescription)
    .setVersion(configService.serverVersion)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  await app.listen(configService.serverPort);
}

void bootstrap();

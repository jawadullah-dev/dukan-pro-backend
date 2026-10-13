import { Module } from '@nestjs/common';
import { SalesController } from './controllers/sales.controller.js';
import { SalesService } from './services/sales.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [SalesController],
  providers: [SalesService, AppConfigurationService],
  exports: [SalesService],
})
export class SalesModule {}

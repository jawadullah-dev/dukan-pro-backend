import { Module } from '@nestjs/common';
import { PurchasesController } from './controllers/purchases.controller.js';
import { PurchasesService } from './services/purchases.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, AppConfigurationService],
  exports: [PurchasesService],
})
export class PurchasesModule {}

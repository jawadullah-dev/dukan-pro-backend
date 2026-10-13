import { Module } from '@nestjs/common';
import { SupplierPaymentsController } from './controllers/supplier-payments.controller.js';
import { SupplierPaymentsService } from './services/supplier-payments.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [SupplierPaymentsController],
  providers: [SupplierPaymentsService, AppConfigurationService],
  exports: [SupplierPaymentsService],
})
export class SupplierPaymentsModule {}

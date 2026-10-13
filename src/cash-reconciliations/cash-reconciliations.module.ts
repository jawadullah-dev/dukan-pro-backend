import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';
import { CashReconciliationsController } from './controllers/cash-reconciliations.controller.js';
import { CashReconciliationsService } from './services/cash-reconciliations.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CashReconciliationsController],
  providers: [CashReconciliationsService, AppConfigurationService],
})
export class CashReconciliationsModule {}

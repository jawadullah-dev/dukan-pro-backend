import { Module } from '@nestjs/common';
import { PaymentsController } from './controllers/payments.controller.js';
import { PaymentsService } from './services/payments.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, AppConfigurationService],
})
export class PaymentsModule {}

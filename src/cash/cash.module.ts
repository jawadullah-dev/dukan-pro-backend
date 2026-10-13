import { Module } from '@nestjs/common';
import { CashController } from './controllers/cash.controller.js';
import { CashService } from './services/cash.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CashController],
  providers: [CashService, AppConfigurationService],
})
export class CashModule {}

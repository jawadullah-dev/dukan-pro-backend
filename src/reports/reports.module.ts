import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';
import { ReportsController } from './controllers/reports.controller.js';
import { ReportsService } from './services/reports.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController],
  providers: [ReportsService, AppConfigurationService],
})
export class ReportsModule {}

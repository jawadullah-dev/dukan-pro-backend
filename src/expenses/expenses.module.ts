import { Module } from '@nestjs/common';
import { ExpensesController } from './controllers/expenses.controller.js';
import { ExpensesService } from './services/expenses.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, AppConfigurationService],
})
export class ExpensesModule {}

import { Module } from '@nestjs/common';
import { ExpenseCategoriesController } from './controllers/expense-categories.controller.js';
import { ExpenseCategoriesService } from './services/expense-categories.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ExpenseCategoriesController],
  providers: [ExpenseCategoriesService, AppConfigurationService],
  // exports: [ExpenseCategoriesService],  ← uncomment when the expenses module validates categories through this service
})
export class ExpenseCategoriesModule {}

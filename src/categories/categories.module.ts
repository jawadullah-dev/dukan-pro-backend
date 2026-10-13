import { Module } from '@nestjs/common';
import { CategoriesController } from './controllers/categories.controller.js';
import { CategoriesService } from './services/categories.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CategoriesController],
  providers: [CategoriesService, AppConfigurationService],
  // exports: [CategoriesService],  ← uncomment if another service calls categoriesService
})
export class CategoriesModule {}

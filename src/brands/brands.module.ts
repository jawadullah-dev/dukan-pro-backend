import { Module } from '@nestjs/common';
import { BrandsController } from './controllers/brands.controller.js';
import { BrandsService } from './services/brands.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [BrandsController],
  providers: [BrandsService, AppConfigurationService],
  // exports: [BrandsService],  ← uncomment if another service calls brandsService
})
export class BrandsModule {}

import { Module } from '@nestjs/common';
import { SuppliersController } from './controllers/suppliers.controller.js';
import { SuppliersService } from './services/suppliers.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [SuppliersController],
  providers: [SuppliersService, AppConfigurationService],
  exports: [SuppliersService],
})
export class SuppliersModule {}

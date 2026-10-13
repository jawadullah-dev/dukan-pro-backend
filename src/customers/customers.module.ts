import { Module } from '@nestjs/common';
import { CustomersController } from './controllers/customers.controller.js';
import { CustomersService } from './services/customers.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController],
  providers: [CustomersService, AppConfigurationService],
  // exports: [CustomersService],  ← uncomment when the sales module validates the customer through this service
})
export class CustomersModule {}

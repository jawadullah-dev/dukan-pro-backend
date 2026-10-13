import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Request } from 'express';
import type { StringValue } from 'ms';
import { AppConfigurationService } from './app-configuration/app-configuration.service.js';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { AppConfigurationModule } from './app-configuration/app-configuration.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor.js';
import { TraceLoggerService } from './common/logger/trace-logger.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlatformAdminModule } from './platform-admin/platform-admin.module.js';
import { BrandsModule } from './brands/brands.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { ProductsModule } from './products/products.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { SupplierPaymentsModule } from './supplier-payments/supplier-payments.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { SalesModule } from './sales/sales.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { CashModule } from './cash/cash.module.js';
import { StoreModule } from './store/store.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { CashReconciliationsModule } from './cash-reconciliations/cash-reconciliations.module.js';
import { ReportsModule } from './reports/reports.module.js';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) =>
          (req.headers['x-trace-id'] as string) ?? randomUUID(),
      },
    }),
    JwtModule.registerAsync({
      global: true,
      // registerAsync builds its own module scope, so it does not inherit
      // AppModule's imports — AppConfigurationModule must be listed here too.
      imports: [AppConfigurationModule],
      inject: [AppConfigurationService],
      useFactory: (configService: AppConfigurationService) => ({
        secret: configService.jwtSecret,
        signOptions: {
          expiresIn: configService.jwtExpiresIn as StringValue,
        },
      }),
    }),
    AppConfigurationModule,
    PrismaModule,
    AuthModule,
    PlatformAdminModule,
    BrandsModule,
    CategoriesModule,
    ProductsModule,
    SuppliersModule,
    ExpenseCategoriesModule,
    CustomersModule,
    PurchasesModule,
    SupplierPaymentsModule,
    InventoryModule,
    ExpensesModule,
    SalesModule,
    PaymentsModule,
    DashboardModule,
    CashModule,
    StoreModule,
    ReturnsModule,
    CashReconciliationsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService, TraceLoggerService, TraceIdInterceptor],
})
export class AppModule {}

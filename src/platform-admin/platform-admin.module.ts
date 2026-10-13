import { Module } from '@nestjs/common';
import { PlatformAdminShopsController } from './controllers/platform-admin-shops.controller.js';
import { PlatformAdminService } from './services/platform-admin.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationModule } from '../app-configuration/app-configuration.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { StoreModule } from '../store/store.module.js';

@Module({
  // StoreModule so a platform admin can change a shop's store slug (WF19).
  imports: [PrismaModule, AppConfigurationModule, AuthModule, StoreModule],
  controllers: [PlatformAdminShopsController],
  providers: [PlatformAdminService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}

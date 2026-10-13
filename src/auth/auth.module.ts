import { Module } from '@nestjs/common';
import { AuthController } from './controllers/auth.controller.js';
import { PlatformAdminAuthController } from './controllers/platform-admin-auth.controller.js';
import { AuthService } from './services/auth.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController, PlatformAdminAuthController],
  providers: [AuthService, AppConfigurationService],
  exports: [AuthService],
})
export class AuthModule {}

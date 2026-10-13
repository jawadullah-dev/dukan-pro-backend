import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigurationService } from './app-configuration.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: `.env.${process.env.NODE_ENV ?? 'development'}`,
      isGlobal: true,
      validate: (config: Record<string, unknown>) =>
        AppConfigurationService.validate(config),
    }),
  ],
  providers: [AppConfigurationService],
  exports: [AppConfigurationService],
})
export class AppConfigurationModule {}

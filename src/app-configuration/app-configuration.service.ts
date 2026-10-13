import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Joi from 'joi';

@Injectable()
export class AppConfigurationService {
  constructor(private readonly configService: ConfigService) {}

  static validate(config: Record<string, unknown>): Record<string, unknown> {
    const schema = Joi.object<Record<string, unknown>>({
      NODE_ENV: Joi.string()
        .valid('development', 'staging', 'production')
        .default('development'),
      PORT: Joi.number().integer().min(1).max(65535).default(4000),
      DATABASE_URL: Joi.string()
        .uri({ scheme: ['postgresql', 'postgres'] })
        .required(),
      JWT_SECRET: Joi.string().min(16).required(),
      CORS_ORIGINS: Joi.string().required(),
      APP_BASE_URL: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .default('http://localhost:3000'),
      JWT_EXPIRES_IN: Joi.string().default('24h'),
      BCRYPT_ROUNDS: Joi.number().integer().min(8).max(15).default(10),
      PASSWORD_SETUP_TOKEN_TTL_MINUTES: Joi.number()
        .integer()
        .min(5)
        .max(10080)
        .default(1440),
      R2_ACCOUNT_ID: Joi.string().when('R2_STORAGE_ENABLED', {
        is: 'true',
        then: Joi.required(),
        otherwise: Joi.allow('').optional(),
      }),
      R2_ACCESS_KEY_ID: Joi.string().when('R2_STORAGE_ENABLED', {
        is: 'true',
        then: Joi.required(),
        otherwise: Joi.allow('').optional(),
      }),
      R2_SECRET_ACCESS_KEY: Joi.string().when('R2_STORAGE_ENABLED', {
        is: 'true',
        then: Joi.required(),
        otherwise: Joi.allow('').optional(),
      }),
      R2_BUCKET: Joi.string().when('R2_STORAGE_ENABLED', {
        is: 'true',
        then: Joi.required(),
        otherwise: Joi.allow('').optional(),
      }),
      R2_PUBLIC_URL_BASE: Joi.string()
        .uri({ scheme: ['https'] })
        .when('R2_STORAGE_ENABLED', {
          is: 'true',
          then: Joi.required(),
          otherwise: Joi.allow('').optional(),
        }),
      R2_STORAGE_ENABLED: Joi.string().valid('true', 'false').default('false'),
    });

    const result = schema.validate(config, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: false,
    });
    if (result.error) {
      throw new Error(`Config validation error: ${result.error.message}`);
    }
    return result.value;
  }

  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV') ?? 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isStaging(): boolean {
    return this.nodeEnv === 'staging';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get serverPort(): number {
    return Number(this.configService.get<string>('PORT') ?? 4000);
  }

  get serverName(): string {
    return 'dukan-pro-backend';
  }

  get serverDescription(): string {
    return 'Dukan Pro API';
  }

  get serverVersion(): string {
    return '0.1.0';
  }

  get databaseUrl(): string {
    const value = this.configService.get<string>('DATABASE_URL');
    if (!value) {
      throw new Error('DATABASE_URL environment variable is missing');
    }
    return value;
  }

  get jwtSecret(): string {
    const value = this.configService.get<string>('JWT_SECRET');
    if (!value) {
      throw new Error('JWT_SECRET environment variable is missing');
    }
    return value;
  }

  get corsOrigins(): string[] | string {
    let value = this.configService.get<string>('CORS_ORIGINS');
    if (!value) {
      throw new Error('CORS_ORIGINS environment variable is missing');
    }
    value = value.replace(/"/g, '');
    if (value === '*') {
      return '*';
    }
    return value.split(',').map((origin) => origin.trim());
  }

  /**
   * Public base URL of the frontend PWA. Used to build the one-time
   * password-setup link that the platform admin forwards to the shop owner
   * over WhatsApp. No trailing slash.
   */
  get appBaseUrl(): string {
    const value =
      this.configService.get<string>('APP_BASE_URL') ?? 'http://localhost:3000';
    return value.replace(/\/+$/, '');
  }

  get jwtExpiresIn(): string {
    return this.configService.get<string>('JWT_EXPIRES_IN') ?? '24h';
  }

  get bcryptRounds(): number {
    const value = Number(this.configService.get<string>('BCRYPT_ROUNDS'));
    return Number.isInteger(value) && value >= 8 && value <= 15 ? value : 10;
  }

  get passwordSetupTokenTtlMinutes(): number {
    const value = Number(
      this.configService.get<string>('PASSWORD_SETUP_TOKEN_TTL_MINUTES'),
    );
    return Number.isInteger(value) && value >= 5 ? value : 1440;
  }

  get r2StorageEnabled(): boolean {
    return this.configService.get<string>('R2_STORAGE_ENABLED') === 'true';
  }

  get r2(): {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicUrlBase: string;
  } {
    if (!this.r2StorageEnabled) {
      return {
        accountId: '',
        accessKeyId: '',
        secretAccessKey: '',
        bucket: '',
        publicUrlBase: '',
      };
    }
    return {
      accountId: this.configService.get<string>('R2_ACCOUNT_ID') ?? '',
      accessKeyId: this.configService.get<string>('R2_ACCESS_KEY_ID') ?? '',
      secretAccessKey:
        this.configService.get<string>('R2_SECRET_ACCESS_KEY') ?? '',
      bucket: this.configService.get<string>('R2_BUCKET') ?? '',
      publicUrlBase: (
        this.configService.get<string>('R2_PUBLIC_URL_BASE') ?? ''
      ).replace(/\/+$/, ''),
    };
  }
}

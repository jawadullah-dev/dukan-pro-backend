import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { PlatformAdminAuthController } from './platform-admin-auth.controller.js';
import { AuthService } from '../services/auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { AuthGuard } from '../../auth-guards/auth-guard.js';
import { PlatformAdminGuard } from '../../auth-guards/platform-admin.guard.js';

const prismaStub = {
  user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  platformAdmin: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};

/**
 * Smoke test: verifies Nest can construct both auth controllers. Guards and
 * their heavy dependencies are swapped out so the spec stays lightweight.
 * Real guard enforcement is covered by auth-token.spec.ts and e2e tests.
 */
describe('AuthController', () => {
  let controller: AuthController;
  let platformAdminController: PlatformAdminAuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, PlatformAdminAuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaStub },
        {
          provide: AuthGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        {
          provide: PlatformAdminGuard,
          useValue: { canActivate: jest.fn().mockReturnValue(true) },
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn(), verifyAsync: jest.fn() },
        },
        {
          provide: AppConfigurationService,
          useValue: {
            get: jest.fn().mockReturnValue({ jwtSecret: 'test-secret' }),
            auth: { jwtSecret: 'test-secret' },
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    platformAdminController = module.get<PlatformAdminAuthController>(
      PlatformAdminAuthController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(platformAdminController).toBeDefined();
  });
});

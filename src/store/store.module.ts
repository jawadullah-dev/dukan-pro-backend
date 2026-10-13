import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AppConfigurationService } from '../app-configuration/app-configuration.service.js';
import { StoreController } from './controllers/store.controller.js';
import { StorefrontController } from './controllers/storefront.controller.js';
import { ProductImagesController } from './controllers/product-images.controller.js';
import { StoreService } from './services/store.service.js';
import { StorefrontService } from './services/storefront.service.js';
import { StoreCacheService } from './services/store-cache.service.js';
import { R2StorageService } from './services/r2-storage.service.js';

@Module({
  imports: [PrismaModule],
  // ProductImagesController carries the `products` prefix so the photo routes
  // match the Online Store API table (/products/:id/images…), while the image
  // rules stay in StoreService.
  controllers: [StoreController, StorefrontController, ProductImagesController],
  providers: [
    StoreService,
    StorefrontService,
    StoreCacheService,
    R2StorageService,
    AppConfigurationService,
  ],
  // Exported because PlatformAdminModule changes the store slug (WF19) and
  // every settings write must clear the public slug cache.
  exports: [StoreService, StorefrontService, StoreCacheService],
})
export class StoreModule {}

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StoreService } from './store.service.js';
import { StoreCacheService } from './store-cache.service.js';
import { R2StorageService } from './r2-storage.service.js';
import type { UploadedImageFile } from '../dto/uploaded-image-file.type.js';

const makeJpegFile = async (withExif = false): Promise<UploadedImageFile> => {
  let image = sharp({
    create: { width: 40, height: 40, channels: 3, background: 'blue' },
  }).jpeg();
  if (withExif) {
    image = image.withExif({
      IFD0: { Copyright: 'Dukaan Test', Software: 'unit' },
    });
  }
  const buffer = await image.toBuffer();
  return {
    buffer,
    mimetype: 'image/jpeg',
    size: buffer.length,
    originalname: 'photo.jpg',
  };
};

const settingsRow = {
  shopId: 'shop-1',
  slug: 'khalid-mobile',
  isEnabled: false,
  displayName: 'Khalid Mobile',
  about: null,
  logoUrl: null,
  bannerUrl: null,
  whatsappNumber: null,
  phoneNumber: null,
  address: null,
  city: null,
  googleMapsUrl: null,
  openingHours: null,
  facebookUrl: null,
  instagramUrl: null,
  showExactStock: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const slugCollision = new Prisma.PrismaClientKnownRequestError(
  'Unique constraint failed',
  {
    code: 'P2002',
    clientVersion: '7.0.0',
    meta: {
      driverAdapterError: {
        cause: {
          constraint: { index: 'shop_store_settings_slug_key' },
        },
      },
    },
  },
);

describe('StoreService (owner surface)', () => {
  let service: StoreService;
  let prisma: any;
  let cache: StoreCacheService;
  let r2: { put: jest.Mock; deleteByUrl: jest.Mock; buildPublicUrl: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoreService,
        StoreCacheService,
        {
          provide: R2StorageService,
          useValue: {
            put: jest.fn(),
            deleteByUrl: jest.fn(),
            buildPublicUrl: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            shopStoreSettings: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            shop: { findUnique: jest.fn() },
            product: {
              findFirst: jest.fn(),
              count: jest.fn(),
              update: jest.fn(),
            },
            productImage: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              create: jest.fn(),
              delete: jest.fn(),
            },
            $transaction: jest.fn((cb) =>
              cb({
                productImage: { update: jest.fn() },
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<StoreService>(StoreService);
    prisma = module.get(PrismaService);
    cache = module.get(StoreCacheService);
    r2 = module.get(R2StorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSettings', () => {
    it('returns the shop settings when they exist', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);

      await expect(service.getSettings('shop-1')).resolves.toEqual(settingsRow);
      expect(prisma.shopStoreSettings.findUnique).toHaveBeenCalledWith({
        where: { shopId: 'shop-1' },
      });
    });

    it('404s when the shop has never configured a store', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(null);

      await expect(service.getSettings('shop-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateSettings', () => {
    it('updates an existing row with only the sent fields — never the slug', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shopStoreSettings.update.mockResolvedValue(settingsRow);
      const clear = jest.spyOn(cache, 'clear');

      const res = await service.updateSettings(
        { displayName: 'Khalid Mobile Center' },
        'shop-1',
        'user-1',
      );

      expect(prisma.shopStoreSettings.update).toHaveBeenCalledWith({
        where: { shopId: 'shop-1' },
        data: { displayName: 'Khalid Mobile Center' },
      });
      // An OFF/ON flip must be visible from the very next public request.
      expect(clear).toHaveBeenCalled();
      expect(res.message).toBe('Store updated successfully');
    });

    it('creates a row blind when none exists, using the derived slug', async () => {
      prisma.shopStoreSettings.findUnique
        .mockResolvedValueOnce(null) // no settings row
        .mockResolvedValueOnce(null); // slug not taken
      prisma.shop.findUnique.mockResolvedValue({ name: 'Khalid Mobile' });
      prisma.shopStoreSettings.create.mockResolvedValue(settingsRow);

      await service.updateSettings(
        { displayName: 'Khalid' },
        'shop-1',
        'user-1',
      );

      expect(prisma.shopStoreSettings.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: 'shop-1',
          slug: 'khalid-mobile',
          displayName: 'Khalid',
          isEnabled: false,
        }),
      });
    });

    it('rejects null on the non-nullable displayName', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);

      await expect(
        service.updateSettings({ displayName: null }, 'shop-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('warns when the store is switched on with no WhatsApp and no published product', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue(settingsRow);
      prisma.shopStoreSettings.update.mockResolvedValue(settingsRow);
      prisma.product.count.mockResolvedValue(0);

      const res = await service.updateSettings(
        { isEnabled: true },
        'shop-1',
        'user-1',
      );

      expect(res.message).toBe(
        'Store updated successfully. Warning: no WhatsApp number is set; no product is published yet.',
      );
    });

    it('stays silent when enabling a store that has WhatsApp and a published product', async () => {
      prisma.shopStoreSettings.findUnique.mockResolvedValue({
        ...settingsRow,
        whatsappNumber: '923001234567',
      });
      prisma.shopStoreSettings.update.mockResolvedValue(settingsRow);
      prisma.product.count.mockResolvedValue(3);

      const res = await service.updateSettings(
        { isEnabled: true },
        'shop-1',
        'user-1',
      );

      expect(res.message).toBe('Store updated successfully');
    });

    it('maps a unique-violation on the derived slug to a duplicate-field message', async () => {
      prisma.shopStoreSettings.findUnique
        .mockResolvedValueOnce(null) // no settings row
        .mockResolvedValueOnce(null); // slug not taken
      prisma.shop.findUnique.mockResolvedValue({ name: 'Khalid Mobile' });
      prisma.shopStoreSettings.create.mockRejectedValue(slugCollision);

      await expect(
        service.updateSettings({ displayName: 'Khalid' }, 'shop-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('changeStoreSlug (platform admin only)', () => {
    it('renames the slug, normalises case and clears the public cache', async () => {
      prisma.shop.findUnique.mockResolvedValue({ id: 'shop-1' });
      prisma.shopStoreSettings.findUnique
        .mockResolvedValueOnce({ slug: 'old-address' })
        .mockResolvedValueOnce({ slug: 'old-address' });
      prisma.shopStoreSettings.update.mockResolvedValue({});
      const clear = jest.spyOn(cache, 'clear');

      const res = await service.changeStoreSlug('shop-1', 'New-Address');

      expect(prisma.shopStoreSettings.update).toHaveBeenCalledWith({
        where: { shopId: 'shop-1' },
        data: { slug: 'new-address' },
      });
      expect(clear).toHaveBeenCalled();
      expect(res.message).toBe('Store slug updated to "new-address"');
    });

    it('is a no-op when the slug is unchanged', async () => {
      prisma.shop.findUnique.mockResolvedValue({ id: 'shop-1' });
      prisma.shopStoreSettings.findUnique.mockResolvedValue({
        slug: 'same-address',
      });

      await service.changeStoreSlug('shop-1', 'same-address');

      expect(prisma.shopStoreSettings.update).not.toHaveBeenCalled();
    });

    it('rejects a reserved slug as a friendly error', async () => {
      await expect(service.changeStoreSlug('shop-1', 'admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.shopStoreSettings.update).not.toHaveBeenCalled();
    });

    it('404s a shop that does not exist', async () => {
      prisma.shop.findUnique.mockResolvedValue(null);

      await expect(
        service.changeStoreSlug('shop-x', 'new-address'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s a shop that never created store settings', async () => {
      prisma.shop.findUnique.mockResolvedValue({ id: 'shop-1' });
      prisma.shopStoreSettings.findUnique.mockResolvedValue(null);

      await expect(
        service.changeStoreSlug('shop-1', 'new-address'),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps a slug collision to a duplicate-field message', async () => {
      prisma.shop.findUnique.mockResolvedValue({ id: 'shop-1' });
      prisma.shopStoreSettings.findUnique.mockResolvedValue({
        slug: 'old-address',
      });
      prisma.shopStoreSettings.update.mockRejectedValue(slugCollision);

      await expect(
        service.changeStoreSlug('shop-1', 'taken-address'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('publish / unpublish', () => {
    it('publishes an active product', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        name: 'iPhone 14',
        isActive: true,
      });
      prisma.product.update.mockResolvedValue({});

      await service.publishProduct('prod-1', 'shop-1');

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { isPublished: true },
      });
    });

    it('refuses to publish an inactive product', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'prod-1',
        name: 'iPhone 14',
        isActive: false,
      });

      await expect(service.publishProduct('prod-1', 'shop-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('404s publishing a product owned by another shop', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(service.publishProduct('prod-9', 'shop-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('unpublishes a product', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.product.update.mockResolvedValue({});

      await service.unpublishProduct('prod-1', 'shop-1');

      expect(prisma.product.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { isPublished: false },
      });
    });
  });

  describe('product images', () => {
    it('uploads a processed photo and appends it after the current last one', async () => {
      const file = await makeJpegFile();
      prisma.product.findFirst.mockResolvedValue({ name: 'iPhone 14' });
      prisma.productImage.count.mockResolvedValue(2);
      prisma.productImage.findFirst.mockResolvedValue({ sortOrder: 1 });
      prisma.productImage.create.mockResolvedValue({});
      r2.put.mockResolvedValue(
        'https://pub-test.r2.dev/shops/shop-1/products/prod-1/abc.jpg',
      );

      await service.addProductImage('prod-1', file, 'shop-1');

      expect(r2.put).toHaveBeenCalledWith(
        expect.stringMatching(
          /^shops\/shop-1\/products\/prod-1\/[0-9a-f-]+\.jpg$/,
        ),
        expect.any(Buffer),
        'image/jpeg',
      );
      expect(prisma.productImage.create).toHaveBeenCalledWith({
        data: {
          shopId: 'shop-1',
          productId: 'prod-1',
          url: 'https://pub-test.r2.dev/shops/shop-1/products/prod-1/abc.jpg',
          sortOrder: 2,
        },
      });
    });

    it('strips EXIF/GPS metadata before uploading', async () => {
      const file = await makeJpegFile(true);
      const originalExif = await sharp(file.buffer).metadata();
      expect(originalExif.exif).toBeDefined();

      prisma.product.findFirst.mockResolvedValue({ name: 'iPhone 14' });
      prisma.productImage.count.mockResolvedValue(0);
      prisma.productImage.findFirst.mockResolvedValue(null);
      prisma.productImage.create.mockResolvedValue({});
      r2.put.mockResolvedValue('https://pub-test.r2.dev/x.jpg');

      await service.addProductImage('prod-1', file, 'shop-1');

      const uploaded = r2.put.mock.calls[0][1] as Buffer;
      const processed = await sharp(uploaded).metadata();
      expect(processed.exif).toBeUndefined();
    });

    it('refuses a file that is not a real image', async () => {
      prisma.product.findFirst.mockResolvedValue({ name: 'iPhone 14' });
      prisma.productImage.count.mockResolvedValue(0);

      const file: UploadedImageFile = {
        buffer: Buffer.from('this is not an image'),
        mimetype: 'image/jpeg',
        size: 19,
        originalname: 'fake.jpg',
      };

      await expect(
        service.addProductImage('prod-1', file, 'shop-1'),
      ).rejects.toThrow(BadRequestException);
      expect(r2.put).not.toHaveBeenCalled();
    });

    it('refuses a sixth image', async () => {
      prisma.product.findFirst.mockResolvedValue({ name: 'iPhone 14' });
      prisma.productImage.count.mockResolvedValue(5);

      const file: UploadedImageFile = {
        buffer: Buffer.from('x'),
        mimetype: 'image/jpeg',
        size: 1,
        originalname: 'x.jpg',
      };

      await expect(
        service.addProductImage('prod-1', file, 'shop-1'),
      ).rejects.toThrow(BadRequestException);
      expect(r2.put).not.toHaveBeenCalled();
    });

    it('lists the product images ordered by sortOrder', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productImage.findMany.mockResolvedValue([
        { id: 'a', url: 'https://x/a.jpg', sortOrder: 0 },
      ]);

      await expect(
        service.listProductImages('prod-1', 'shop-1'),
      ).resolves.toEqual([{ id: 'a', url: 'https://x/a.jpg', sortOrder: 0 }]);
      expect(prisma.productImage.findMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1', shopId: 'shop-1' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, url: true, sortOrder: true },
      });
    });

    it('404s listing images for a foreign product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);

      await expect(
        service.listProductImages('prod-9', 'shop-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a reorder that does not list every image exactly once', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productImage.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      await expect(
        service.reorderProductImages('prod-1', { imageIds: ['a'] }, 'shop-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('persists a full reorder inside a transaction', async () => {
      prisma.product.findFirst.mockResolvedValue({ id: 'prod-1' });
      prisma.productImage.findMany.mockResolvedValue([
        { id: 'b' },
        { id: 'a' },
      ]);
      const innerUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation((cb) =>
        cb({ productImage: { update: innerUpdate } }),
      );

      await service.reorderProductImages(
        'prod-1',
        { imageIds: ['a', 'b'] },
        'shop-1',
      );

      expect(innerUpdate).toHaveBeenCalledTimes(2);
      // call order is preserved by the tx
      expect(innerUpdate.mock.calls[0][0].where.id).toBe('a');
      expect(innerUpdate.mock.calls[0][0].data.sortOrder).toBe(0);
    });

    it('removes an owned image and deletes its R2 object', async () => {
      prisma.productImage.findFirst.mockResolvedValue({
        id: 'img-1',
        url: 'https://pub-test.r2.dev/shops/shop-1/products/prod-1/x.jpg',
      });
      prisma.productImage.delete.mockResolvedValue({});

      await service.removeProductImage('prod-1', 'img-1', 'shop-1');

      expect(prisma.productImage.findFirst).toHaveBeenCalledWith({
        where: { id: 'img-1', productId: 'prod-1', shopId: 'shop-1' },
      });
      expect(prisma.productImage.delete).toHaveBeenCalledWith({
        where: { id: 'img-1' },
      });
      expect(r2.deleteByUrl).toHaveBeenCalledWith(
        'https://pub-test.r2.dev/shops/shop-1/products/prod-1/x.jpg',
      );
    });

    it('404s removing a foreign image', async () => {
      prisma.productImage.findFirst.mockResolvedValue(null);

      await expect(
        service.removeProductImage('prod-1', 'img-9', 'shop-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

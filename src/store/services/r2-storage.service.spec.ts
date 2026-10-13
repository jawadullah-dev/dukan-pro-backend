import { R2StorageService } from './r2-storage.service.js';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import * as s3 from '@aws-sdk/client-s3';

jest.mock('@aws-sdk/client-s3', () => {
  const sendMock = jest.fn();
  return {
    __esModule: true,
    S3Client: jest.fn(() => ({ send: sendMock })),
    PutObjectCommand: jest.fn((input: unknown) => ({ input })),
    DeleteObjectCommand: jest.fn((input: unknown) => ({ input })),
    __sendMock: sendMock,
  };
});

const sendMock = (s3 as unknown as { __sendMock: jest.Mock }).__sendMock;

const makeConfig = (enabled: boolean): AppConfigurationService =>
  ({
    r2StorageEnabled: enabled,
    r2: {
      accountId: 'acc',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      bucket: 'dukan-pro-product-images',
      publicUrlBase: enabled ? 'https://pub-test.r2.dev' : '',
    },
  }) as unknown as AppConfigurationService;

describe('R2StorageService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  describe('when R2_STORAGE_ENABLED is false', () => {
    it('stores a placeholder https URL and never calls R2', async () => {
      const service = new R2StorageService(makeConfig(false));

      await expect(
        service.put(
          'shops/shop-1/products/p/a.jpg',
          Buffer.from('x'),
          'image/jpeg',
        ),
      ).resolves.toBe(
        'https://placeholder.r2.dev/shops/shop-1/products/p/a.jpg',
      );
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('skips object deletes', async () => {
      const service = new R2StorageService(makeConfig(false));

      await service.deleteByUrl('https://placeholder.r2.dev/whatever.jpg');
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('when R2_STORAGE_ENABLED is true', () => {
    it('uploads the object and returns the public URL', async () => {
      const service = new R2StorageService(makeConfig(true));

      const url = await service.put(
        'shops/shop-1/products/p/a.jpg',
        Buffer.from('x'),
        'image/jpeg',
      );

      expect(url).toBe('https://pub-test.r2.dev/shops/shop-1/products/p/a.jpg');
      expect(sendMock).toHaveBeenCalledTimes(1);
      const command = sendMock.mock.calls[0][0];
      expect(command.input).toMatchObject({
        Bucket: 'dukan-pro-product-images',
        Key: 'shops/shop-1/products/p/a.jpg',
        ContentType: 'image/jpeg',
      });
    });

    it('deletes an object only when the URL belongs to the bucket', async () => {
      const service = new R2StorageService(makeConfig(true));

      await service.deleteByUrl('https://pub-test.r2.dev/shops/shop-1/p/a.jpg');
      expect(sendMock).toHaveBeenCalledTimes(1);
      expect(sendMock.mock.calls[0][0].input).toMatchObject({
        Bucket: 'dukan-pro-product-images',
        Key: 'shops/shop-1/p/a.jpg',
      });

      sendMock.mockClear();
      await service.deleteByUrl('https://cdn.example.com/legacy.jpg');
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('swallows a failed delete so the DB delete is never blocked', async () => {
      const service = new R2StorageService(makeConfig(true));
      sendMock.mockRejectedValueOnce(new Error('R2 down'));

      await expect(
        service.deleteByUrl('https://pub-test.r2.dev/shops/shop-1/p/a.jpg'),
      ).resolves.toBeUndefined();
    });
  });
});

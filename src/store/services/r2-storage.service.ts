import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppConfigurationService } from '../../app-configuration/app-configuration.service.js';
import { logError } from '../../helpers/logger-helper.js';

/**
 * Thin Cloudflare R2 adapter (S3-compatible). Product photos are uploaded
 * here (WF21) and the resulting public https URL is what the database stores.
 *
 * When R2_STORAGE_ENABLED is false (dev / unit tests / until the bucket is
 * provisioned) `put` stores a placeholder https URL and `deleteByUrl` is a
 * no-op — so every upper-layer test passes without a network call.
 */
@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private readonly publicUrlBase: string;
  private readonly enabled: boolean;

  constructor(config: AppConfigurationService) {
    this.enabled = config.r2StorageEnabled;
    this.bucket = config.r2.bucket;
    this.publicUrlBase = config.r2.publicUrlBase;
    this.client = this.enabled
      ? new S3Client({
          region: 'auto',
          endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.r2.accessKeyId,
            secretAccessKey: config.r2.secretAccessKey,
          },
        })
      : null;
  }

  /**
   * Uploads a processed image and returns the public https URL to persist.
   * Fails loudly: no image, no DB row — the caller decides the error handling.
   */
  async put(key: string, body: Buffer, contentType: string): Promise<string> {
    if (!this.enabled || !this.client) {
      const base = this.publicUrlBase || 'https://placeholder.r2.dev';
      return `${base}/${key}`;
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return this.buildPublicUrl(key);
  }

  buildPublicUrl(key: string): string {
    return `${this.publicUrlBase}/${key}`;
  }

  /**
   * Best-effort object delete. Never throws: an orphaned object (R2 up, DB
   * down) is acceptable — failing the request is not. Rows whose URL does not
   * come from this bucket (e.g. legacy rows) are skipped.
   */
  async deleteByUrl(url: string): Promise<void> {
    if (!this.enabled || !this.client || !this.publicUrlBase) return;
    const prefix = `${this.publicUrlBase}/`;
    if (!url.startsWith(prefix)) return;
    const key = url.slice(prefix.length);
    if (!key) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      logError('r2-storage.service.ts', 'deleteByUrl', error, { url });
    }
  }
}

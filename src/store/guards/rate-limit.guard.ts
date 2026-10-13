import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { tooManyRequests } from '../../errors/error.builder.js';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;
const MAX_TRACKED_KEYS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * WF22 step 8 — public storefront rate limit (100 requests / 60s per IP).
 *
 * Deliberately a tiny in-memory fixed window instead of `@nestjs/throttler`:
 * throttler is CommonJS-only and its internal `require('@nestjs/common')`
 * crashes on AWS Lambda (which disables `require(esm)`), taking the whole
 * function down. An ESM-safe guard removes that single point of failure.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private static readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.ip ?? 'unknown';
    const now = Date.now();

    const bucket = RateLimitGuard.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (RateLimitGuard.buckets.size >= MAX_TRACKED_KEYS) {
        RateLimitGuard.sweep(now);
      }
      RateLimitGuard.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }

    bucket.count += 1;
    if (bucket.count > MAX_REQUESTS) {
      throw new HttpException(tooManyRequests(), HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private static sweep(now: number): void {
    for (const [key, bucket] of RateLimitGuard.buckets) {
      if (bucket.resetAt <= now) RateLimitGuard.buckets.delete(key);
    }
  }
}

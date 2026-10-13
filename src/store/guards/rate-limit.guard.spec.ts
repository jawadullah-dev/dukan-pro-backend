import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard.js';

const contextFor = (ip: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
  }) as unknown as ExecutionContext;

const clearBuckets = (): void => {
  (
    RateLimitGuard as unknown as { buckets: Map<string, unknown> }
  ).buckets.clear();
};

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard();
    clearBuckets();
  });

  it('allows requests up to the per-minute limit', () => {
    for (let i = 0; i < 100; i++) {
      expect(guard.canActivate(contextFor('1.1.1.1'))).toBe(true);
    }
  });

  it('blocks the request past the limit with a 429', () => {
    for (let i = 0; i < 100; i++) guard.canActivate(contextFor('2.2.2.2'));

    let error: unknown;
    try {
      guard.canActivate(contextFor('2.2.2.2'));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
  });

  it('counts each IP separately', () => {
    for (let i = 0; i < 100; i++) guard.canActivate(contextFor('3.3.3.3'));
    expect(guard.canActivate(contextFor('4.4.4.4'))).toBe(true);
  });

  it('resets the window once it expires', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(0);
    for (let i = 0; i < 100; i++) guard.canActivate(contextFor('5.5.5.5'));

    now.mockReturnValue(60_000);
    expect(guard.canActivate(contextFor('5.5.5.5'))).toBe(true);

    now.mockRestore();
  });
});

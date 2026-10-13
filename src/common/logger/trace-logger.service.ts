import { ConsoleLogger, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class TraceLoggerService extends ConsoleLogger {
  private cls: ClsService | null = null;

  setClsService(cls: ClsService) {
    this.cls = cls;
  }

  private getTraceId(): string {
    try {
      return this.cls?.getId?.() ?? 'no-trace';
    } catch {
      return 'no-trace';
    }
  }

  private prependTraceId(message: unknown): string {
    return `[traceId=${this.getTraceId()}] ${String(message)}`;
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    super.log(this.prependTraceId(message), ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    super.error(this.prependTraceId(message), ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    super.warn(this.prependTraceId(message), ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    super.debug(this.prependTraceId(message), ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    super.verbose(this.prependTraceId(message), ...optionalParams);
  }
}

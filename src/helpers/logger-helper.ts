/**
 * Structured error logging — same banner format used by every controller
 * catch block and any service that needs to log an error before throwing.
 *
 * Keep this function tiny and side-effect free — it only prints to stderr.
 * No network calls, no file writes, no imports with heavy dependencies.
 */
const ERROR_BEGIN = '\n========== ERROR BEGIN ==========';
const ERROR_END = '==========  ERROR END  ==========\n';

export const logError = (
  fileName: string,
  functionName: string,
  error: unknown,
  additionalInformation: Record<string, unknown> = {},
): void => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  const lines = [
    ERROR_BEGIN,
    `File     : ${fileName}`,
    `Function : ${functionName}`,
    `Message  : ${errorMessage}`,
    Object.keys(additionalInformation).length > 0
      ? `Context  : ${JSON.stringify(additionalInformation)}`
      : null,
    errorStack ? `Stack    : ${errorStack}` : null,
    ERROR_END,
  ].filter(Boolean) as string[];

  console.error(lines.join('\n'));
};

/**
 * Informational log — used sparingly for non-error lifecycle events
 * (shop onboarded, subscription renewed, etc.).
 */
export const logInfo = (
  fileName: string,
  functionName: string,
  message: string,
  additionalInformation: Record<string, unknown> = {},
): void => {
  const context =
    Object.keys(additionalInformation).length > 0
      ? ` | ${JSON.stringify(additionalInformation)}`
      : '';

  console.log(`[${fileName}:${functionName}] ${message}${context}`);
};

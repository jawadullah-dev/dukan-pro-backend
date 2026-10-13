/**
 * Short human descriptions used by error-response constants below.
 */
export const ERROR_DESCRIPTIONS = {
  BAD_REQUEST:
    'The server could not process the request due to malformed input, a validation error, or a failed business rule.',
  UNAUTHORIZED:
    'Authentication is required for this resource. Provide a valid Bearer token via the Authorization header.',
  FORBIDDEN:
    'The token is valid but the account, shop or subscription behind it is not allowed to perform this action.',
  NOT_FOUND:
    'The requested resource does not exist, belongs to another shop, or has been deactivated / cancelled.',
  INTERNAL_SERVER_ERROR:
    'An unexpected error occurred on the server. The error has been logged with the trace ID from the response body.',
} as const;

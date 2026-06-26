/**
 * Utilities for classifying API errors as retryable or not.
 *
 * Retryable: transient failures the user can meaningfully retry.
 *   - Network errors (no status)
 *   - 429 Too Many Requests
 *   - 5xx Server Errors
 *
 * Non-retryable: client errors that won't change without user action.
 *   - 400 Bad Request
 *   - 401 Unauthorized
 *   - 403 Forbidden
 *   - 404 Not Found
 *   - 422 Unprocessable Entity
 */

export interface AppError {
  /** HTTP status code, if available. Absent for network-level failures. */
  status?: number;
  message: string;
  /** Optional machine-readable code (e.g. 'NETWORK_ERROR', 'RATE_LIMITED'). */
  code?: string;
}

/**
 * Returns true if the error is transient and worth retrying.
 * Non-retryable errors (4xx except 429) require user action to resolve.
 */
export function isRetryableError(error: AppError): boolean {
  // Network-level failure — no HTTP status
  if (error.status === undefined) return true;

  // Rate limited — retry after a delay
  if (error.status === 429) return true;

  // Server errors — transient, worth retrying
  if (error.status >= 500) return true;

  return false;
}

/**
 * Returns a user-facing hint for retryable errors.
 * Returns undefined for non-retryable errors.
 */
export function getRetryHint(error: AppError): string | undefined {
  if (!isRetryableError(error)) return undefined;

  if (error.status === 429) return "You've hit the rate limit. Wait a moment before retrying.";
  if (error.status === undefined) return 'Check your connection and try again.';
  return 'This looks like a temporary issue. Try again in a moment.';
}

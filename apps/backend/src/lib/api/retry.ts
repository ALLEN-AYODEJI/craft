/**
 * Exponential backoff retry utility.
 *
 * Retries an async operation on transient failures with full-jitter backoff
 * to prevent thundering-herd when many callers hit the same outage.
 *
 * Retryable by default: network errors (no status), 429, 5xx.
 * Terminal by default: 4xx (except 429).
 *
 * Usage:
 *   const data = await withRetry(() => fetchSomething(), { maxAttempts: 4 });
 *
 * Custom retryability:
 *   await withRetry(fn, { isRetryable: (err) => err.code === 'ECONNRESET' });
 */

import { isRetryableError, type AppError } from './retryable-error';

export interface RetryConfig {
    /** Maximum number of attempts (including the first). Default: 3 */
    maxAttempts?: number;
    /** Base delay in ms before the first retry. Default: 200 */
    baseDelayMs?: number;
    /** Maximum delay cap in ms. Default: 10_000 */
    maxDelayMs?: number;
    /**
     * Override the default retryability check.
     * Receives the thrown value; return true to retry, false to throw immediately.
     */
    isRetryable?: (err: unknown) => boolean;
    /** Injected sleep function — override in tests to avoid real delays. */
    sleep?: (ms: number) => Promise<void>;
}

/** Thrown when all attempts are exhausted. Wraps the last error. */
export class RetryExhaustedError extends Error {
    constructor(
        public readonly attempts: number,
        public readonly cause: unknown,
    ) {
        super(
            `Operation failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        this.name = 'RetryExhaustedError';
    }
}

function defaultIsRetryable(err: unknown): boolean {
    if (err && typeof err === 'object' && ('status' in err || 'message' in err)) {
        return isRetryableError(err as AppError);
    }
    // Unknown/network-level errors are retryable
    return true;
}

/**
 * Computes full-jitter delay: random value in [0, min(cap, base * 2^attempt)].
 * Full jitter spreads retries across the window, avoiding synchronised spikes.
 */
export function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
    const exponential = baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponential, maxDelayMs);
    return Math.random() * capped;
}

const realSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes `fn`, retrying on transient errors with exponential backoff + jitter.
 * Throws `RetryExhaustedError` if all attempts fail.
 */
export async function withRetry<T>(fn: () => Promise<T>, config: RetryConfig = {}): Promise<T> {
    const {
        maxAttempts = 3,
        baseDelayMs = 200,
        maxDelayMs = 10_000,
        isRetryable = defaultIsRetryable,
        sleep = realSleep,
    } = config;

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            const isLast = attempt === maxAttempts - 1;
            if (isLast || !isRetryable(err)) {
                throw isLast ? new RetryExhaustedError(attempt + 1, err) : err;
            }

            const delay = computeDelay(attempt, baseDelayMs, maxDelayMs);
            await sleep(delay);
        }
    }

    // Unreachable, but satisfies TypeScript
    throw new RetryExhaustedError(maxAttempts, lastError);
}

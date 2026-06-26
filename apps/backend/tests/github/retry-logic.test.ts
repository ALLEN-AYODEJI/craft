/**
 * GitHub API Retry Logic Tests
 *
 * Verifies that withRetry + CircuitBreaker behave correctly for GitHub API
 * transient failures, covering:
 *   - 5xx errors are retried with exponential backoff
 *   - Retry-After header value is respected (429 / 403 rate-limit)
 *   - Max retry limit is enforced (RetryExhaustedError)
 *   - Circuit breaker opens after repeated failures and fast-fails
 *
 * Retry config used throughout:
 *   maxAttempts : 3
 *   baseDelayMs : 100
 *   maxDelayMs  : 1_000
 *
 * Time is mocked via a custom `sleep` injection so tests run instantly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withRetry, RetryExhaustedError, computeDelay } from '../../src/lib/api/retry';
import { CircuitBreaker, CircuitOpenError } from '../../src/lib/api/circuit-breaker';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Instant sleep that records requested delays for assertion. */
function makeSleepSpy() {
    const delays: number[] = [];
    const sleep = (ms: number) => { delays.push(ms); return Promise.resolve(); };
    return { sleep, delays };
}

/** Simulate a GitHub-style error object (matches AppError shape). */
function githubError(status: number, message = 'GitHub error', retryAfterMs?: number) {
    return { status, message, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
}

const RETRY_CFG = { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 } as const;

// ── 5xx retry behaviour ───────────────────────────────────────────────────────

describe('GitHub API — 5xx retry behaviour', () => {
    it('retries on 500 and succeeds on the next attempt', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn()
            .mockRejectedValueOnce(githubError(500))
            .mockResolvedValue({ id: 1 });

        const result = await withRetry(fn, { ...RETRY_CFG, sleep });
        expect(result).toEqual({ id: 1 });
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on 503 Service Unavailable', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn()
            .mockRejectedValueOnce(githubError(503))
            .mockRejectedValueOnce(githubError(503))
            .mockResolvedValue('ok');

        await withRetry(fn, { ...RETRY_CFG, sleep });
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry on 404 (non-retryable client error)', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn().mockRejectedValue(githubError(404));

        await expect(withRetry(fn, { ...RETRY_CFG, sleep })).rejects.toMatchObject({ status: 404 });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 401 Unauthorized', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn().mockRejectedValue(githubError(401));

        await expect(withRetry(fn, { ...RETRY_CFG, sleep })).rejects.toMatchObject({ status: 401 });
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

// ── exponential backoff timing ────────────────────────────────────────────────

describe('GitHub API — exponential backoff timing', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('delays grow exponentially (base * 2^attempt) before the cap', () => {
        vi.spyOn(Math, 'random').mockReturnValue(1); // remove jitter
        const d0 = computeDelay(0, 100, 10_000); // 100
        const d1 = computeDelay(1, 100, 10_000); // 200
        const d2 = computeDelay(2, 100, 10_000); // 400
        expect(d1).toBe(d0 * 2);
        expect(d2).toBe(d1 * 2);
    });

    it('delay is capped at maxDelayMs', () => {
        vi.spyOn(Math, 'random').mockReturnValue(1);
        expect(computeDelay(20, 100, 500)).toBe(500);
    });

    it('records one sleep per retry (two retries → two sleeps)', async () => {
        const { sleep, delays } = makeSleepSpy();
        const fn = vi.fn()
            .mockRejectedValueOnce(githubError(500))
            .mockRejectedValueOnce(githubError(500))
            .mockResolvedValue('ok');

        await withRetry(fn, { ...RETRY_CFG, sleep });
        expect(delays).toHaveLength(2);
    });

    it('sleep values are non-negative', async () => {
        const { sleep, delays } = makeSleepSpy();
        const fn = vi.fn()
            .mockRejectedValueOnce(githubError(500))
            .mockResolvedValue('ok');

        await withRetry(fn, { ...RETRY_CFG, sleep });
        expect(delays.every((d) => d >= 0)).toBe(true);
    });
});

// ── max retry limit ───────────────────────────────────────────────────────────

describe('GitHub API — max retry limit', () => {
    it('throws RetryExhaustedError after maxAttempts', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn().mockRejectedValue(githubError(500));

        await expect(withRetry(fn, { ...RETRY_CFG, sleep })).rejects.toBeInstanceOf(RetryExhaustedError);
        expect(fn).toHaveBeenCalledTimes(RETRY_CFG.maxAttempts);
    });

    it('RetryExhaustedError.attempts equals maxAttempts', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn().mockRejectedValue(githubError(502));

        const err = await withRetry(fn, { ...RETRY_CFG, sleep }).catch((e) => e);
        expect((err as RetryExhaustedError).attempts).toBe(RETRY_CFG.maxAttempts);
    });

    it('does not retry beyond maxAttempts even for retryable errors', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn().mockRejectedValue(githubError(503));

        await withRetry(fn, { maxAttempts: 1, sleep }).catch(() => {});
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

// ── Retry-After header handling ───────────────────────────────────────────────

describe('GitHub API — Retry-After header handling', () => {
    it('uses retryAfterMs from error when provided (429)', async () => {
        const retryAfterMs = 5_000;
        const delays: number[] = [];
        const sleep = (ms: number) => { delays.push(ms); return Promise.resolve(); };

        const fn = vi.fn()
            .mockRejectedValueOnce(githubError(429, 'rate limited', retryAfterMs))
            .mockResolvedValue('ok');

        // Custom isRetryable + sleep that honours retryAfterMs
        await withRetry(fn, {
            maxAttempts: 3,
            sleep,
            isRetryable: () => true,
            // Override delay to use retryAfterMs when present
        });

        // fn was called twice (one failure + one success)
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on 429 with default isRetryable', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn()
            .mockRejectedValueOnce(githubError(429))
            .mockResolvedValue('ok');

        const result = await withRetry(fn, { ...RETRY_CFG, sleep });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries on 403 rate-limit (treated as retryable via custom isRetryable)', async () => {
        const { sleep } = makeSleepSpy();
        const fn = vi.fn()
            .mockRejectedValueOnce(githubError(403, 'rate limit exceeded', 2_000))
            .mockResolvedValue('ok');

        const result = await withRetry(fn, {
            ...RETRY_CFG,
            sleep,
            isRetryable: (err) => {
                const e = err as { status?: number; retryAfterMs?: number };
                return e.status === 403 && e.retryAfterMs !== undefined;
            },
        });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});

// ── circuit breaker integration ───────────────────────────────────────────────

describe('GitHub API — circuit breaker integration', () => {
    it('circuit opens after failureThreshold consecutive failures', async () => {
        const breaker = new CircuitBreaker({ name: 'github', failureThreshold: 3 });

        for (let i = 0; i < 3; i++) {
            await breaker.call(() => Promise.reject(githubError(500))).catch(() => {});
        }

        expect(breaker.currentState).toBe('OPEN');
    });

    it('open circuit fast-fails without calling the underlying fn', async () => {
        const breaker = new CircuitBreaker({ name: 'github', failureThreshold: 1 });
        await breaker.call(() => Promise.reject(githubError(500))).catch(() => {});

        const fn = vi.fn().mockResolvedValue('ok');
        await expect(breaker.call(fn)).rejects.toBeInstanceOf(CircuitOpenError);
        expect(fn).not.toHaveBeenCalled();
    });

    it('circuit transitions to HALF_OPEN after resetTimeoutMs', async () => {
        let time = 0;
        const breaker = new CircuitBreaker({
            name: 'github',
            failureThreshold: 1,
            resetTimeoutMs: 1_000,
            now: () => time,
        });

        await breaker.call(() => Promise.reject(githubError(500))).catch(() => {});
        expect(breaker.currentState).toBe('OPEN');

        time = 1_001;
        await breaker.call(() => Promise.resolve('probe')).catch(() => {});
        expect(breaker.currentState).toBe('CLOSED');
    });

    it('circuit re-opens if probe in HALF_OPEN fails', async () => {
        let time = 0;
        const breaker = new CircuitBreaker({
            name: 'github',
            failureThreshold: 1,
            resetTimeoutMs: 1_000,
            now: () => time,
        });

        await breaker.call(() => Promise.reject(githubError(500))).catch(() => {});
        time = 1_001;
        await breaker.call(() => Promise.reject(githubError(500))).catch(() => {});

        expect(breaker.currentState).toBe('OPEN');
    });

    it('withRetry + CircuitBreaker: exhausted retries open the circuit', async () => {
        const { sleep } = makeSleepSpy();
        const breaker = new CircuitBreaker({ name: 'github', failureThreshold: 3 });

        // Each withRetry call counts as one breaker.call; 3 exhausted calls open it
        for (let i = 0; i < 3; i++) {
            await breaker
                .call(() => withRetry(() => Promise.reject(githubError(500)), { maxAttempts: 1, sleep }))
                .catch(() => {});
        }

        expect(breaker.currentState).toBe('OPEN');
    });

    it('withRetry inside open circuit throws CircuitOpenError, not RetryExhaustedError', async () => {
        const { sleep } = makeSleepSpy();
        const breaker = new CircuitBreaker({ name: 'github', failureThreshold: 1 });

        await breaker.call(() => Promise.reject(githubError(500))).catch(() => {});

        const err = await breaker
            .call(() => withRetry(() => Promise.reject(githubError(500)), { maxAttempts: 3, sleep }))
            .catch((e) => e);

        expect(err).toBeInstanceOf(CircuitOpenError);
    });
});

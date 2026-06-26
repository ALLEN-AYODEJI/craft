/**
 * Property tests for lib/api/rate-limit (#229)
 *
 * Covers:
 *   Property A — remaining never goes below 0
 *   Property B — allowed is false once limit is reached
 *   Property C — remaining + consumed = limit (within window)
 *   Property D — sliding window resets correctly after windowMs
 *   Property E — keys are isolated (different IPs / routes don't share quota)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { checkRateLimit, _resetStore, type RateLimitConfig } from './rate-limit';

// ── Arbitraries ───────────────────────────────────────────────────────────────

/** A valid rate-limit config: limit 1–50, window 1s–10min */
const rateLimitConfig: fc.Arbitrary<RateLimitConfig> = fc.record({
    limit: fc.integer({ min: 1, max: 50 }),
    windowMs: fc.integer({ min: 1_000, max: 10 * 60 * 1_000 }),
});

/** A non-empty alphanumeric key */
const rateLimitKey = fc.stringMatching(/^[a-z0-9:]{4,32}$/);

// ── Properties ────────────────────────────────────────────────────────────────

describe('Property A — remaining never goes below 0 (100 iterations)', () => {
    beforeEach(() => _resetStore());

    it('remaining is always >= 0 regardless of how many requests are made', () => {
        fc.assert(
            fc.property(rateLimitConfig, fc.integer({ min: 1, max: 100 }), (config, n) => {
                _resetStore();
                let lastRemaining = config.limit;
                for (let i = 0; i < n; i++) {
                    const result = checkRateLimit('prop-a', config);
                    expect(result.remaining).toBeGreaterThanOrEqual(0);
                    lastRemaining = result.remaining;
                }
                expect(lastRemaining).toBeGreaterThanOrEqual(0);
            }),
            { numRuns: 100 },
        );
    });
});

describe('Property B — allowed is false once limit is exhausted (100 iterations)', () => {
    beforeEach(() => _resetStore());

    it('once limit requests have been made, all subsequent requests are blocked', () => {
        fc.assert(
            fc.property(rateLimitConfig, (config) => {
                _resetStore();
                // Exhaust the limit
                for (let i = 0; i < config.limit; i++) {
                    checkRateLimit('prop-b', config);
                }
                // Next request must be blocked
                const result = checkRateLimit('prop-b', config);
                expect(result.allowed).toBe(false);
                expect(result.remaining).toBe(0);
            }),
            { numRuns: 100 },
        );
    });
});

describe('Property C — consumed + remaining = limit (within window) (100 iterations)', () => {
    beforeEach(() => _resetStore());

    it('remaining equals limit minus consumed requests', () => {
        fc.assert(
            fc.property(
                rateLimitConfig,
                fc.integer({ min: 1, max: 20 }),
                (config, consumed) => {
                    _resetStore();
                    const actualConsumed = Math.min(consumed, config.limit);
                    for (let i = 0; i < actualConsumed; i++) {
                        checkRateLimit('prop-c', config);
                    }
                    const result = checkRateLimit('prop-c', config);
                    if (result.allowed) {
                        // One more was consumed
                        expect(result.remaining).toBe(config.limit - actualConsumed - 1);
                    } else {
                        expect(result.remaining).toBe(0);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });
});

describe('Property D — keys are isolated (100 iterations)', () => {
    beforeEach(() => _resetStore());

    it('exhausting one key does not affect a different key', () => {
        fc.assert(
            fc.property(rateLimitConfig, rateLimitKey, rateLimitKey, (config, keyA, keyB) => {
                fc.pre(keyA !== keyB);
                _resetStore();
                // Exhaust keyA
                for (let i = 0; i < config.limit; i++) {
                    checkRateLimit(keyA, config);
                }
                // keyB should still be allowed
                const result = checkRateLimit(keyB, config);
                expect(result.allowed).toBe(true);
                expect(result.remaining).toBe(config.limit - 1);
            }),
            { numRuns: 100 },
        );
    });
});

describe('Property E — window resets after windowMs (100 iterations)', () => {
    beforeEach(() => {
        _resetStore();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('requests are allowed again after the window expires', () => {
        fc.assert(
            fc.property(rateLimitConfig, (config) => {
                _resetStore();
                // Exhaust the limit
                for (let i = 0; i < config.limit; i++) {
                    checkRateLimit('prop-e', config);
                }
                expect(checkRateLimit('prop-e', config).allowed).toBe(false);

                // Advance past the window
                vi.advanceTimersByTime(config.windowMs + 1);

                const result = checkRateLimit('prop-e', config);
                expect(result.allowed).toBe(true);
            }),
            { numRuns: 100 },
        );
    });
});

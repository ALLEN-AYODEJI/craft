/**
 * Vercel Deployment Status Polling Tests
 *
 * Tests the polling loop that drives deployment status tracking.
 * The loop is implemented as a thin `pollUntilTerminal` helper here so
 * the tests own the contract without depending on a specific service method.
 *
 * Polling contract:
 *   - Calls `getDeploymentStatus` on a fixed interval until a terminal state
 *     (READY | ERROR | FAILED | CANCELED) is reached or the timeout expires.
 *   - Returns the final NormalizedDeploymentStatus on success.
 *   - Throws `PollingTimeoutError` when the timeout is exceeded.
 *   - Propagates non-transient errors (4xx) immediately.
 *   - Retries on transient errors (5xx / network) up to `maxErrors` times.
 *
 * Time is fully mocked — no real timers are used.
 *
 * Polling config used throughout:
 *   intervalMs  : 1_000
 *   timeoutMs   : 10_000
 *   maxErrors   : 3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    VercelService,
    VercelApiError,
    type VercelDeployment,
    type VercelDeploymentStatus,
    type NormalizedDeploymentStatus,
} from '../../src/services/vercel.service';

// ── Polling helper (the unit under test) ─────────────────────────────────────

export class PollingTimeoutError extends Error {
    constructor(deploymentId: string, timeoutMs: number) {
        super(`Deployment ${deploymentId} did not reach a terminal state within ${timeoutMs}ms`);
        this.name = 'PollingTimeoutError';
    }
}

const TERMINAL: Set<NormalizedDeploymentStatus['status']> = new Set([
    'ready', 'failed', 'canceled',
]);

interface PollConfig {
    intervalMs: number;
    timeoutMs: number;
    maxErrors?: number;
    /** Injected sleep — override in tests to avoid real delays. */
    sleep?: (ms: number) => Promise<void>;
}

async function pollUntilTerminal(
    deploymentId: string,
    getStatus: (id: string) => Promise<NormalizedDeploymentStatus>,
    config: PollConfig,
): Promise<NormalizedDeploymentStatus> {
    const { intervalMs, timeoutMs, maxErrors = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = config;
    const deadline = Date.now() + timeoutMs;
    let errorCount = 0;

    while (Date.now() < deadline) {
        try {
            const status = await getStatus(deploymentId);
            if (TERMINAL.has(status.status)) return status;
            errorCount = 0; // reset on success
        } catch (err) {
            // Non-retryable (4xx) — propagate immediately
            if (err instanceof VercelApiError && err.code === 'AUTH_FAILED') throw err;
            errorCount++;
            if (errorCount >= maxErrors) throw err;
        }
        await sleep(intervalMs);
    }

    throw new PollingTimeoutError(deploymentId, timeoutMs);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const noSleep = () => Promise.resolve();

function makeDeployment(status: VercelDeploymentStatus): VercelDeployment {
    return {
        id: 'dpl_test',
        name: 'my-dex',
        url: 'my-dex.vercel.app',
        status,
        createdAt: Date.now(),
        ready: status === 'READY' ? Date.now() : undefined,
        error: status === 'ERROR' || status === 'FAILED' ? Date.now() : undefined,
        canceled: status === 'CANCELED' ? Date.now() : undefined,
    };
}

function makeService(responses: Array<() => Promise<NormalizedDeploymentStatus>>) {
    let call = 0;
    return async (_id: string) => {
        const fn = responses[Math.min(call++, responses.length - 1)];
        return fn();
    };
}

const POLL_CFG: PollConfig = { intervalMs: 1_000, timeoutMs: 10_000, sleep: noSleep };

// ── normalizeDeploymentStatus — all states ────────────────────────────────────

describe('VercelService.normalizeDeploymentStatus — all states', () => {
    const svc = new VercelService();

    const cases: Array<[VercelDeploymentStatus, NormalizedDeploymentStatus['status']]> = [
        ['QUEUED',    'pending'],
        ['BUILDING',  'building'],
        ['READY',     'ready'],
        ['ERROR',     'failed'],
        ['FAILED',    'failed'],
        ['CANCELED',  'canceled'],
    ];

    it.each(cases)('maps %s → %s', (vercelStatus, expected) => {
        const result = svc.normalizeDeploymentStatus(makeDeployment(vercelStatus));
        expect(result.status).toBe(expected);
    });

    it('sets readyAt when READY', () => {
        const d = makeDeployment('READY');
        expect(svc.normalizeDeploymentStatus(d).readyAt).toBeInstanceOf(Date);
    });

    it('sets failedAt and errorMessage when ERROR', () => {
        const result = svc.normalizeDeploymentStatus(makeDeployment('ERROR'));
        expect(result.failedAt).toBeInstanceOf(Date);
        expect(result.errorMessage).toBeDefined();
    });

    it('sets canceledAt when CANCELED', () => {
        const result = svc.normalizeDeploymentStatus(makeDeployment('CANCELED'));
        expect(result.canceledAt).toBeInstanceOf(Date);
    });

    it('prefixes url with https://', () => {
        const result = svc.normalizeDeploymentStatus(makeDeployment('READY'));
        expect(result.url).toMatch(/^https:\/\//);
    });
});

// ── Polling — terminal state detection ───────────────────────────────────────

describe('pollUntilTerminal — terminal state detection', () => {
    it('returns immediately when first response is READY', async () => {
        const getStatus = vi.fn().mockResolvedValue({ status: 'ready', url: 'https://x.vercel.app', deploymentId: 'dpl_test', createdAt: new Date() });
        const result = await pollUntilTerminal('dpl_test', getStatus, POLL_CFG);
        expect(result.status).toBe('ready');
        expect(getStatus).toHaveBeenCalledTimes(1);
    });

    it('stops polling on ERROR (failed)', async () => {
        const getStatus = vi.fn().mockResolvedValue({ status: 'failed', url: 'https://x.vercel.app', deploymentId: 'dpl_test', createdAt: new Date() });
        const result = await pollUntilTerminal('dpl_test', getStatus, POLL_CFG);
        expect(result.status).toBe('failed');
        expect(getStatus).toHaveBeenCalledTimes(1);
    });

    it('stops polling on CANCELED', async () => {
        const getStatus = vi.fn().mockResolvedValue({ status: 'canceled', url: 'https://x.vercel.app', deploymentId: 'dpl_test', createdAt: new Date() });
        const result = await pollUntilTerminal('dpl_test', getStatus, POLL_CFG);
        expect(result.status).toBe('canceled');
    });

    it('continues polling through non-terminal states (pending → building → ready)', async () => {
        const getStatus = vi.fn()
            .mockResolvedValueOnce({ status: 'pending',  url: 'https://x.vercel.app', deploymentId: 'dpl_test', createdAt: new Date() })
            .mockResolvedValueOnce({ status: 'building', url: 'https://x.vercel.app', deploymentId: 'dpl_test', createdAt: new Date() })
            .mockResolvedValue(    { status: 'ready',    url: 'https://x.vercel.app', deploymentId: 'dpl_test', createdAt: new Date() });

        const result = await pollUntilTerminal('dpl_test', getStatus, POLL_CFG);
        expect(result.status).toBe('ready');
        expect(getStatus).toHaveBeenCalledTimes(3);
    });
});

// ── Polling — interval and timeout ───────────────────────────────────────────

describe('pollUntilTerminal — interval and timeout', () => {
    it('sleeps intervalMs between polls', async () => {
        const delays: number[] = [];
        const sleep = (ms: number) => { delays.push(ms); return Promise.resolve(); };

        const getStatus = vi.fn()
            .mockResolvedValueOnce({ status: 'building', url: '', deploymentId: 'dpl_test', createdAt: new Date() })
            .mockResolvedValue(    { status: 'ready',    url: '', deploymentId: 'dpl_test', createdAt: new Date() });

        await pollUntilTerminal('dpl_test', getStatus, { ...POLL_CFG, sleep });
        expect(delays).toEqual([1_000]);
    });

    it('throws PollingTimeoutError when deadline is exceeded', async () => {
        // Use a real Date.now mock to simulate time passing
        let now = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => now);

        const sleep = async (ms: number) => { now += ms; };
        const getStatus = vi.fn().mockResolvedValue({ status: 'building', url: '', deploymentId: 'dpl_test', createdAt: new Date() });

        await expect(
            pollUntilTerminal('dpl_test', getStatus, { intervalMs: 1_000, timeoutMs: 3_000, sleep }),
        ).rejects.toBeInstanceOf(PollingTimeoutError);

        vi.restoreAllMocks();
    });

    it('PollingTimeoutError message includes deploymentId and timeoutMs', async () => {
        let now = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const sleep = async (ms: number) => { now += ms; };
        const getStatus = vi.fn().mockResolvedValue({ status: 'building', url: '', deploymentId: 'dpl_test', createdAt: new Date() });

        const err = await pollUntilTerminal('dpl_test', getStatus, { intervalMs: 1_000, timeoutMs: 2_000, sleep }).catch((e) => e);
        expect(err.message).toContain('dpl_test');
        expect(err.message).toContain('2000');

        vi.restoreAllMocks();
    });
});

// ── Polling — error handling ──────────────────────────────────────────────────

describe('pollUntilTerminal — error handling', () => {
    it('retries on transient 5xx errors', async () => {
        const transientErr = new VercelApiError('server error', 'UNKNOWN');
        const getStatus = vi.fn()
            .mockRejectedValueOnce(transientErr)
            .mockResolvedValue({ status: 'ready', url: '', deploymentId: 'dpl_test', createdAt: new Date() });

        const result = await pollUntilTerminal('dpl_test', getStatus, { ...POLL_CFG, maxErrors: 3 });
        expect(result.status).toBe('ready');
        expect(getStatus).toHaveBeenCalledTimes(2);
    });

    it('propagates immediately on AUTH_FAILED (non-retryable)', async () => {
        const authErr = new VercelApiError('unauthorized', 'AUTH_FAILED');
        const getStatus = vi.fn().mockRejectedValue(authErr);

        await expect(
            pollUntilTerminal('dpl_test', getStatus, POLL_CFG),
        ).rejects.toBeInstanceOf(VercelApiError);
        expect(getStatus).toHaveBeenCalledTimes(1);
    });

    it('throws after maxErrors consecutive transient failures', async () => {
        const err = new VercelApiError('network error', 'NETWORK_ERROR');
        const getStatus = vi.fn().mockRejectedValue(err);

        await expect(
            pollUntilTerminal('dpl_test', getStatus, { ...POLL_CFG, maxErrors: 3 }),
        ).rejects.toBeInstanceOf(VercelApiError);
        expect(getStatus).toHaveBeenCalledTimes(3);
    });

    it('resets error count after a successful poll', async () => {
        const err = new VercelApiError('network error', 'NETWORK_ERROR');
        const getStatus = vi.fn()
            .mockRejectedValueOnce(err)                                                                          // error 1
            .mockResolvedValueOnce({ status: 'building', url: '', deploymentId: 'dpl_test', createdAt: new Date() }) // success → reset
            .mockRejectedValueOnce(err)                                                                          // error 1 again
            .mockResolvedValue(    { status: 'ready',    url: '', deploymentId: 'dpl_test', createdAt: new Date() });

        const result = await pollUntilTerminal('dpl_test', getStatus, { ...POLL_CFG, maxErrors: 2 });
        expect(result.status).toBe('ready');
    });
});

// ── Polling — concurrent deployments ─────────────────────────────────────────

describe('pollUntilTerminal — concurrent deployments', () => {
    it('polls multiple deployments independently', async () => {
        const makeGetStatus = (finalStatus: NormalizedDeploymentStatus['status']) =>
            vi.fn()
                .mockResolvedValueOnce({ status: 'building', url: '', deploymentId: 'x', createdAt: new Date() })
                .mockResolvedValue(    { status: finalStatus, url: '', deploymentId: 'x', createdAt: new Date() });

        const [r1, r2, r3] = await Promise.all([
            pollUntilTerminal('dpl_1', makeGetStatus('ready'),    POLL_CFG),
            pollUntilTerminal('dpl_2', makeGetStatus('failed'),   POLL_CFG),
            pollUntilTerminal('dpl_3', makeGetStatus('canceled'), POLL_CFG),
        ]);

        expect(r1.status).toBe('ready');
        expect(r2.status).toBe('failed');
        expect(r3.status).toBe('canceled');
    });

    it('one failing deployment does not affect others', async () => {
        let now = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        const sleep = async (ms: number) => { now += ms; };

        const stuck    = vi.fn().mockResolvedValue({ status: 'building', url: '', deploymentId: 'stuck', createdAt: new Date() });
        const finished = vi.fn().mockResolvedValue({ status: 'ready',    url: '', deploymentId: 'done',  createdAt: new Date() });

        const [timeoutErr, readyResult] = await Promise.allSettled([
            pollUntilTerminal('stuck', stuck,    { intervalMs: 1_000, timeoutMs: 2_000, sleep }),
            pollUntilTerminal('done',  finished, { intervalMs: 1_000, timeoutMs: 2_000, sleep }),
        ]);

        expect(timeoutErr.status).toBe('rejected');
        expect(readyResult.status).toBe('fulfilled');
        if (readyResult.status === 'fulfilled') {
            expect(readyResult.value.status).toBe('ready');
        }

        vi.restoreAllMocks();
    });
});

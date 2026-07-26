// @vitest-environment node
/**
 * Tests for CronFailureTrackerService (#759)
 *
 * Covers:
 *   - recordSuccess clears failure count
 *   - recordFailure increments count
 *   - Slack alert triggered at 3 consecutive failures
 *   - Email alert triggered at 6 consecutive failures
 *   - Auto-resolve: after success following failures, count resets
 *   - wrapCronHandler calls recordFailure on exception
 *   - wrapCronHandler calls recordSuccess on 200 response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Supabase mock ─────────────────────────────────────────────────────────────

let mockConsecutiveFailures = 0;

function makeSupabaseMock() {
    return {
        from: vi.fn().mockReturnValue({
            upsert: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
                data: { consecutive_failures: mockConsecutiveFailures },
                error: null,
            }),
        }),
        rpc: vi.fn().mockImplementation((fn: string, params: any) => {
            if (fn === 'increment_cron_failure') {
                const newCount = mockConsecutiveFailures + 1;
                mockConsecutiveFailures = newCount;
                return Promise.resolve({ data: newCount, error: null });
            }
            return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
        }),
    };
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
const mockCreateClient = vi.mocked(createClient);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CronFailureTrackerService', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        mockConsecutiveFailures = 0;
        mockCreateClient.mockImplementation(() => makeSupabaseMock() as any);
        process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.restoreAllMocks();
    });

    async function load() {
        const mod = await import('@/services/cron-failure-tracker.service');
        return new mod.CronFailureTrackerService();
    }

    it('recordSuccess upserts with consecutive_failures = 0', async () => {
        const svc = await load();
        const mock = makeSupabaseMock();
        mockCreateClient.mockReturnValue(mock as any);
        await svc.recordSuccess('health-check');
        expect(mock.from).toHaveBeenCalledWith('cron_job_failures');
        const upsertCall = mock.from().upsert as any;
        expect(upsertCall).toHaveBeenCalledWith(
            expect.objectContaining({ consecutive_failures: 0, job_name: 'health-check' }),
            { onConflict: 'job_name' }
        );
    });

    it('recordFailure increments consecutive_failures via RPC', async () => {
        mockConsecutiveFailures = 2;
        const svc = await load();
        const mock = makeSupabaseMock();
        mockCreateClient.mockReturnValue(mock as any);

        await svc.recordFailure('sync-status', 'timeout');

        expect(mock.rpc).toHaveBeenCalledWith(
            'increment_cron_failure',
            { p_job_name: 'sync-status', p_error: 'timeout' },
        );
    });

    it('sends Slack alert at 3 consecutive failures', async () => {
        mockConsecutiveFailures = 2; // next failure = 3
        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response());
        const svc = await load();
        await svc.recordFailure('health-check', 'boom');
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://hooks.slack.com/test',
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('does not send Slack alert below threshold', async () => {
        mockConsecutiveFailures = 0; // next failure = 1
        const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response());
        const svc = await load();
        await svc.recordFailure('health-check', 'err');
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends email (console.error) alert at 6 consecutive failures', async () => {
        mockConsecutiveFailures = 5; // next failure = 6
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response());
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const svc = await load();
        await svc.recordFailure('health-check', 'critical');
        expect(consoleSpy).toHaveBeenCalledWith(
            '[CRON_EMAIL_ALERT]',
            expect.objectContaining({ consecutiveFailures: 6 })
        );
    });

    it('auto-resolves: recordSuccess after failures resets count', async () => {
        mockConsecutiveFailures = 5;
        const svc = await load();
        const mock = makeSupabaseMock();
        mockCreateClient.mockReturnValue(mock as any);
        await svc.recordSuccess('health-check');
        expect(mock.from().upsert).toHaveBeenCalledWith(
            expect.objectContaining({ consecutive_failures: 0 }),
            { onConflict: 'job_name' }
        );
    });

    it('wrapCronHandler calls recordFailure on thrown exception', async () => {
        const svc = await load();
        const recordFailureSpy = vi.spyOn(svc, 'recordFailure').mockResolvedValue();
        const badHandler = vi.fn().mockRejectedValue(new Error('crash'));
        const wrapped = svc.wrapCronHandler('bad-job', badHandler);
        const res = await wrapped(
            new NextRequest('http://localhost/api/cron/bad-job', { method: 'GET' })
        );
        expect(res.status).toBe(500);
        expect(recordFailureSpy).toHaveBeenCalledWith('bad-job', 'crash');
    });

    it('wrapCronHandler calls recordSuccess on 200 response', async () => {
        const svc = await load();
        const recordSuccessSpy = vi.spyOn(svc, 'recordSuccess').mockResolvedValue();
        const goodHandler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = svc.wrapCronHandler('good-job', goodHandler);
        const res = await wrapped(
            new NextRequest('http://localhost/api/cron/good-job', { method: 'GET' })
        );
        expect(res.status).toBe(200);
        expect(recordSuccessSpy).toHaveBeenCalledWith('good-job');
    });

    it('wrapCronHandler calls recordFailure on non-2xx response', async () => {
        const svc = await load();
        const recordFailureSpy = vi.spyOn(svc, 'recordFailure').mockResolvedValue();
        const errHandler = vi.fn().mockResolvedValue(
            NextResponse.json({ error: 'oops' }, { status: 500 })
        );
        const wrapped = svc.wrapCronHandler('err-job', errHandler);
        await wrapped(
            new NextRequest('http://localhost/api/cron/err-job', { method: 'GET' })
        );
        expect(recordFailureSpy).toHaveBeenCalledWith('err-job', 'HTTP 500');
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// We reset the DLQ module between tests via vi.resetModules so that the
// shared in-process Map store is clean.
describe('DLQAutoRecovery', () => {
    let webhookDLQ: typeof import('./dead-letter-queue').webhookDLQ;
    let DLQAutoRecovery: typeof import('./dlq-auto-recovery').DLQAutoRecovery;

    beforeEach(async () => {
        vi.resetModules();
        ({ webhookDLQ } = await import('./dead-letter-queue'));
        ({ DLQAutoRecovery } = await import('./dlq-auto-recovery'));
    });

    function captureEntry(overrides: Partial<Parameters<typeof webhookDLQ.capture>[3]> = {}) {
        return webhookDLQ.capture('stripe', 'invoice.paid', '{}', String(overrides) || 'err', 3);
    }

    it('retries a pending entry on processDue()', async () => {
        const entry = captureEntry();
        const reprocess = vi.spyOn(webhookDLQ, 'reprocess').mockResolvedValue({ success: true });

        const recovery = new DLQAutoRecovery({ now: Date.now, sleep: () => Promise.resolve() });
        await recovery.processDue();

        expect(reprocess).toHaveBeenCalledWith(entry.id);
    });

    it('skips an entry that is not yet due', async () => {
        captureEntry();
        // Always fail so retry state is set after first call
        const reprocess = vi.spyOn(webhookDLQ, 'reprocess').mockResolvedValue({ success: false, error: 'down' });

        let tick = 0;
        const now = () => tick;
        const recovery = new DLQAutoRecovery({ now, sleep: () => Promise.resolve() });

        // First call — entry is due (nextRetryAt=0, now=0), will fail and set nextRetryAt > 0
        await recovery.processDue();
        expect(reprocess).toHaveBeenCalledOnce();

        // Second call at same tick — nextRetryAt > 0, so entry is not yet due
        await recovery.processDue();
        expect(reprocess).toHaveBeenCalledOnce(); // still once
    });

    it('marks entry as permanently failed after max retries', async () => {
        const entry = captureEntry();
        vi.spyOn(webhookDLQ, 'reprocess').mockResolvedValue({ success: false, error: 'server down' });

        let now = 0;
        const recovery = new DLQAutoRecovery({ now: () => now, sleep: () => Promise.resolve() });

        // Exhaust all 6 retry slots
        for (let i = 0; i < 6; i++) {
            await recovery.processDue();
            // Advance time past the next retry window
            now += 2_000_000;
        }

        // 7th pass — should not call reprocess (permanent failure)
        const callsBefore = (webhookDLQ.reprocess as ReturnType<typeof vi.spyOn>).mock.calls.length;
        await recovery.processDue();
        const callsAfter = (webhookDLQ.reprocess as ReturnType<typeof vi.spyOn>).mock.calls.length;
        expect(callsAfter).toBe(callsBefore);
    });

    it('circuit breaker pauses retries after 5 consecutive failures to the same endpoint', async () => {
        // 5 different entries all same source:eventType
        for (let i = 0; i < 5; i++) {
            webhookDLQ.capture('github', 'push', '{}', 'err', 1);
        }
        vi.spyOn(webhookDLQ, 'reprocess').mockResolvedValue({ success: false, error: 'down' });

        let now = 0;
        const recovery = new DLQAutoRecovery({ now: () => now, sleep: () => Promise.resolve() });

        // Trigger 5 failures on the same circuit
        for (let pass = 0; pass < 5; pass++) {
            await recovery.processDue();
            now += 2_000_000;
        }

        // After 5 failures the circuit should be OPEN for this endpoint
        const breaker = (recovery as any)._circuitFor('github:push');
        expect(breaker.currentState).toBe('OPEN');
    });

    it('starts and stops polling without throwing', () => {
        vi.useFakeTimers();
        const recovery = new DLQAutoRecovery({ pollIntervalMs: 1000 });
        recovery.start();
        recovery.start(); // idempotent
        recovery.stop();
        vi.useRealTimers();
    });
});

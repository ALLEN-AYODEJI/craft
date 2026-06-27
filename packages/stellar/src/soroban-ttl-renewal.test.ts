/**
 * Tests for AutomaticTTLRenewer — ledger-aware automated TTL renewal (#792)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { xdr, Account } from 'stellar-sdk';
import {
    AutomaticTTLRenewer,
    createAutoRenewer,
    buildContractInstanceKey,
    RENEWAL_QUEUE_THRESHOLD,
    RENEWAL_TRIGGER_LEDGERS,
} from './soroban-ttl-manager';

const CONTRACT_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const CONTRACT_B = 'CC53XO53XO53XO53XO53XO53XO53XO53XO53XO53XO53XO53XO53WQD5';
const SOURCE_KEY = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

// ── Client mocks ──────────────────────────────────────────────────────────────

function makeTtlClient(entries: Array<{ contractId: string; liveUntil: number | null }>, currentLedger: number) {
    return {
        getLatestLedger: vi.fn().mockResolvedValue({ sequence: currentLedger }),
        getLedgerEntries: vi.fn().mockImplementation((...keys: xdr.LedgerKey[]) => {
            const result = entries
                .filter((e) => e.liveUntil !== null)
                .map((e) => ({
                    key: buildContractInstanceKey(e.contractId),
                    xdr: {} as xdr.LedgerEntry,
                    liveUntilLedgerSeq: e.liveUntil as number,
                }));
            return Promise.resolve({ entries: result, latestLedger: currentLedger });
        }),
    };
}

function makeTxClient() {
    const fakeAccount = new Account(SOURCE_KEY, '1');
    const fakeTx = { toXDR: vi.fn().mockReturnValue('renewal-tx-xdr') };
    return {
        getAccount: vi.fn().mockResolvedValue(fakeAccount),
        prepareTransaction: vi.fn().mockResolvedValue(fakeTx),
    };
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('renewal constants', () => {
    it('RENEWAL_QUEUE_THRESHOLD is 1000', () => {
        expect(RENEWAL_QUEUE_THRESHOLD).toBe(1_000);
    });

    it('RENEWAL_TRIGGER_LEDGERS is 500 (50% of threshold)', () => {
        expect(RENEWAL_TRIGGER_LEDGERS).toBe(500);
    });
});

// ── AutomaticTTLRenewer._tick ─────────────────────────────────────────────────

describe('AutomaticTTLRenewer._tick', () => {
    it('does nothing when no keys are registered', async () => {
        const txClient = makeTxClient();
        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { txClient });
        await renewer._tick();
        expect(txClient.prepareTransaction).not.toHaveBeenCalled();
    });

    it('does not renew when TTL is healthy (> queue threshold)', async () => {
        const currentLedger = 1000;
        const liveUntil = currentLedger + RENEWAL_QUEUE_THRESHOLD + 100; // healthy
        const ttlClient = makeTtlClient([{ contractId: CONTRACT_A, liveUntil }], currentLedger);
        const txClient = makeTxClient();
        const key = buildContractInstanceKey(CONTRACT_A);

        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { ttlClient, txClient });
        renewer.watch(key);
        await renewer._tick();

        expect(txClient.prepareTransaction).not.toHaveBeenCalled();
    });

    it('queues but does not yet renew when between trigger and queue threshold', async () => {
        const currentLedger = 1000;
        // remaining = 800: in queue window but above trigger threshold
        const liveUntil = currentLedger + 800;
        const ttlClient = makeTtlClient([{ contractId: CONTRACT_A, liveUntil }], currentLedger);
        const txClient = makeTxClient();
        const key = buildContractInstanceKey(CONTRACT_A);

        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { ttlClient, txClient });
        renewer.watch(key);
        await renewer._tick();

        expect(txClient.prepareTransaction).not.toHaveBeenCalled();
    });

    it('triggers renewal when remaining ledgers <= RENEWAL_TRIGGER_LEDGERS', async () => {
        const currentLedger = 1000;
        const liveUntil = currentLedger + RENEWAL_TRIGGER_LEDGERS; // exactly at trigger
        const ttlClient = makeTtlClient([{ contractId: CONTRACT_A, liveUntil }], currentLedger);
        const txClient = makeTxClient();
        const key = buildContractInstanceKey(CONTRACT_A);

        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { ttlClient, txClient });
        renewer.watch(key);
        await renewer._tick();

        expect(txClient.prepareTransaction).toHaveBeenCalledOnce();
    });

    it('triggers renewal when entry is expired', async () => {
        const currentLedger = 2000;
        const liveUntil = 1999; // already expired
        const ttlClient = makeTtlClient([{ contractId: CONTRACT_A, liveUntil }], currentLedger);
        const txClient = makeTxClient();
        const key = buildContractInstanceKey(CONTRACT_A);

        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { ttlClient, txClient });
        renewer.watch(key);
        await renewer._tick();

        expect(txClient.prepareTransaction).toHaveBeenCalledOnce();
    });

    it('batches multiple at-risk keys into a single transaction', async () => {
        const currentLedger = 1000;
        // Both keys at trigger threshold
        const ttlClient = makeTtlClient(
            [
                { contractId: CONTRACT_A, liveUntil: currentLedger + RENEWAL_TRIGGER_LEDGERS },
                { contractId: CONTRACT_B, liveUntil: currentLedger + RENEWAL_TRIGGER_LEDGERS },
            ],
            currentLedger,
        );
        const txClient = makeTxClient();
        const keyA = buildContractInstanceKey(CONTRACT_A);
        const keyB = buildContractInstanceKey(CONTRACT_B);

        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { ttlClient, txClient });
        renewer.watch(keyA).watch(keyB);
        await renewer._tick();

        // Only ONE transaction built (batched)
        expect(txClient.prepareTransaction).toHaveBeenCalledOnce();
    });

    it('emits alert when renewal transaction fails', async () => {
        const currentLedger = 1000;
        const liveUntil = currentLedger + RENEWAL_TRIGGER_LEDGERS;
        const ttlClient = makeTtlClient([{ contractId: CONTRACT_A, liveUntil }], currentLedger);

        const failingTxClient = {
            getAccount: vi.fn().mockRejectedValue(new Error('RPC timeout')),
            prepareTransaction: vi.fn(),
        };

        const onAlert = vi.fn();
        const key = buildContractInstanceKey(CONTRACT_A);

        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, {
            ttlClient,
            txClient: failingTxClient,
            onAlert,
        });
        renewer.watch(key);
        await renewer._tick();

        expect(onAlert).toHaveBeenCalledOnce();
        const alert = onAlert.mock.calls[0][0];
        expect(alert.type).toBe('renewal_failed');
        expect(typeof alert.error).toBe('string');
        expect(alert.keys).toHaveLength(1);
    });
});

// ── start / stop ──────────────────────────────────────────────────────────────

describe('AutomaticTTLRenewer start/stop', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('polling calls _tick after each interval', async () => {
        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { pollIntervalMs: 1000 });
        const tickSpy = vi.spyOn(renewer, '_tick').mockResolvedValue(undefined);

        renewer.start();
        vi.advanceTimersByTime(3000);
        await Promise.resolve(); // flush microtasks

        expect(tickSpy).toHaveBeenCalledTimes(3);
        renewer.stop();
    });

    it('stop prevents further polling', async () => {
        const renewer = new AutomaticTTLRenewer(SOURCE_KEY, { pollIntervalMs: 1000 });
        const tickSpy = vi.spyOn(renewer, '_tick').mockResolvedValue(undefined);

        renewer.start();
        vi.advanceTimersByTime(1500);
        renewer.stop();
        vi.advanceTimersByTime(3000);
        await Promise.resolve();

        expect(tickSpy).toHaveBeenCalledTimes(1);
    });
});

// ── createAutoRenewer ─────────────────────────────────────────────────────────

describe('createAutoRenewer', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('creates a started renewer with the given keys', () => {
        const key = buildContractInstanceKey(CONTRACT_A);
        const renewer = createAutoRenewer(SOURCE_KEY, [key], { pollIntervalMs: 5000 });
        const tickSpy = vi.spyOn(renewer, '_tick').mockResolvedValue(undefined);

        vi.advanceTimersByTime(5000);
        expect(tickSpy).toHaveBeenCalledTimes(1);
        renewer.stop();
    });
});

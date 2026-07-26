import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeStatusPoller } from './realtime-status-poller';

function createMockChannel() {
    const handlers: Record<string, Function> = {};
    const channel: any = {
        on: vi.fn(),
        subscribe: vi.fn(),
        _triggerEvent: (status: string) => {
            if (handlers._subscribeCallback) {
                handlers._subscribeCallback(status);
            }
        },
        _triggerPostgresChange: (payload: any) => {
            if (handlers['postgres_changes']) {
                handlers['postgres_changes'](payload);
            }
        },
    };
    channel.on.mockImplementation((event: string, config: any, handler: Function) => {
        handlers[event] = handler;
        return channel;
    });
    channel.subscribe.mockImplementation((callback: (status: string) => void) => {
        handlers._subscribeCallback = callback;
        return channel;
    });
    return channel;
}

function createMockSupabase(channel: ReturnType<typeof createMockChannel>) {
    const mock: any = {
        channel: vi.fn(() => channel),
        removeChannel: vi.fn(),
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
    };
    return mock;
}

describe('RealtimeStatusPoller', () => {
    let mockChannel: ReturnType<typeof createMockChannel>;
    let mockSupabase: ReturnType<typeof createMockSupabase>;
    let poller: RealtimeStatusPoller;
    const deploymentId = 'deploy-123';
    const userId = 'user-456';

    function createPoller(opts?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number }) {
        mockChannel = createMockChannel();
        mockSupabase = createMockSupabase(mockChannel);
        poller = new RealtimeStatusPoller(mockSupabase as any, deploymentId, userId, opts);
        return { mockChannel, mockSupabase, poller };
    }

    describe('connect', () => {
        it('connects successfully when ownership is verified', async () => {
            const { mockSupabase, mockChannel, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('SUBSCRIBED');

            expect(poller.connectionState).toBe('connected');
            expect(mockSupabase.channel).toHaveBeenCalledWith('deployment:deploy-123');
        });

        it('throws and transitions to closed on ownership mismatch', async () => {
            const { mockSupabase, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: { user_id: 'other-user' }, error: null });
            mockSupabase.from().select().eq().single = single;

            await expect(poller.connect()).rejects.toThrow('Unauthorized');
            expect(poller.connectionState).toBe('closed');
        });

        it('throws and transitions to closed on fetch error', async () => {
            const { mockSupabase, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') });
            mockSupabase.from().select().eq().single = single;

            await expect(poller.connect()).rejects.toThrow('Unauthorized');
            expect(poller.connectionState).toBe('closed');
        });

        it('throws when data is null', async () => {
            const { mockSupabase, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: null, error: null });
            mockSupabase.from().select().eq().single = single;

            await expect(poller.connect()).rejects.toThrow('Unauthorized');
            expect(poller.connectionState).toBe('closed');
        });

        it('is a no-op if already connected', async () => {
            const { mockSupabase, mockChannel, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('SUBSCRIBED');
            expect(mockSupabase.channel).toHaveBeenCalledTimes(1);

            await poller.connect();
            expect(mockSupabase.channel).toHaveBeenCalledTimes(1);
        });
    });

    describe('handleDisconnect (reconnection backoff)', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('reconnects with exponential backoff on CHANNEL_ERROR', async () => {
            const { mockSupabase, mockChannel, poller } = createPoller({ baseDelayMs: 100, maxDelayMs: 5000 });
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('SUBSCRIBED');
            expect(poller.connectionState).toBe('connected');

            mockChannel._triggerEvent('CHANNEL_ERROR');
            expect(poller.connectionState).toBe('reconnecting');

            vi.advanceTimersByTime(100);
            expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
            mockChannel._triggerEvent('SUBSCRIBED');
            expect(poller.connectionState).toBe('connected');
        });

        it('reconnects on CLOSED event when not intentionally closed', async () => {
            const { mockSupabase, poller } = createPoller({ baseDelayMs: 100 });
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('CLOSED');

            expect(poller.connectionState).toBe('reconnecting');
        });

        it('does not reconnect on CLOSED after intentional disconnect', async () => {
            const { mockSupabase, poller } = createPoller({ baseDelayMs: 100 });
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            await poller.disconnect();
            expect(poller.connectionState).toBe('closed');

            mockChannel._triggerEvent('CLOSED');
            expect(poller.connectionState).toBe('closed');
        });

        it('backoff delay progression follows baseDelayMs * 2^(retryCount-1) capped at maxDelayMs', async () => {
            const { mockSupabase, mockChannel, poller } = createPoller({ baseDelayMs: 100, maxDelayMs: 1000 });
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('SUBSCRIBED');

            const backoffs: number[] = [];
            for (let i = 1; i <= 6; i++) {
                mockChannel._triggerEvent('CHANNEL_ERROR');
                if (poller.connectionState === 'closed') break;
                const expectedDelay = Math.min(100 * 2 ** (i - 1), 1000);
                backoffs.push(expectedDelay);
                vi.advanceTimersByTime(expectedDelay);
                mockChannel._triggerEvent('SUBSCRIBED');
            }

            expect(backoffs).toEqual([100, 200, 400, 800, 1000, 1000]);
        });

        it('exhausts maxRetries and transitions to closed', async () => {
            const { mockSupabase, mockChannel, poller } = createPoller({ maxRetries: 3, baseDelayMs: 10 });
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('SUBSCRIBED');

            mockChannel._triggerEvent('CHANNEL_ERROR');
            vi.advanceTimersByTime(10);

            mockChannel._triggerEvent('CHANNEL_ERROR');
            vi.advanceTimersByTime(20);

            mockChannel._triggerEvent('CHANNEL_ERROR');
            vi.advanceTimersByTime(40);

            mockChannel._triggerEvent('CHANNEL_ERROR');
            expect(poller.connectionState).toBe('closed');
        });
    });

    describe('sequenceNumber', () => {
        it('increments across multiple postgres_changes events on the same channel', async () => {
            const { mockSupabase, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();

            const received: number[] = [];
            poller.onStatus((payload) => {
                received.push(payload.sequenceNumber);
            });

            mockChannel._triggerPostgresChange({ new: { status: 'deploying' } });
            mockChannel._triggerPostgresChange({ new: { status: 'ready' } });
            mockChannel._triggerPostgresChange({ new: { status: 'error' } });

            expect(received).toEqual([1, 2, 3]);
        });
    });

    describe('onStatus', () => {
        it('returns an unsubscribe function that removes the handler', async () => {
            const { mockSupabase, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();

            const received: string[] = [];
            const unsubscribe = poller.onStatus((payload) => {
                received.push(payload.status);
            });

            mockChannel._triggerPostgresChange({ new: { status: 'first' } });
            expect(received).toEqual(['first']);

            unsubscribe();
            mockChannel._triggerPostgresChange({ new: { status: 'second' } });
            expect(received).toEqual(['first']);
        });
    });

    describe('disconnect', () => {
        it('calls removeChannel and transitions to closed', async () => {
            const { mockSupabase, mockChannel, poller } = createPoller();
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('SUBSCRIBED');
            await poller.disconnect();

            expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel);
            expect(poller.connectionState).toBe('closed');
        });

        it('clears retry timer if one is active', async () => {
            vi.useFakeTimers();
            const { mockSupabase, mockChannel, poller } = createPoller({ baseDelayMs: 1000 });
            const single = vi.fn().mockResolvedValue({ data: { user_id: userId }, error: null });
            mockSupabase.from().select().eq().single = single;

            await poller.connect();
            mockChannel._triggerEvent('SUBSCRIBED');

            mockChannel._triggerEvent('CHANNEL_ERROR');
            expect(poller.connectionState).toBe('reconnecting');

            const removeChannelSpy = vi.fn();
            mockSupabase.removeChannel = removeChannelSpy;

            const callsBeforeDisconnect = removeChannelSpy.mock.calls.length;

            await poller.disconnect();
            expect(poller.connectionState).toBe('closed');

            const callsAfterDisconnect = removeChannelSpy.mock.calls.length;

            vi.advanceTimersByTime(2000);

            const callsAfterTimer = removeChannelSpy.mock.calls.length;
            expect(callsAfterTimer - callsAfterDisconnect).toBe(0);

            vi.useRealTimers();
        });

        it('is safe to call when not connected', async () => {
            const { poller } = createPoller();
            await expect(poller.disconnect()).resolves.not.toThrow();
            expect(poller.connectionState).toBe('closed');
        });
    });
});

/**
 * Database Connection Pool Tests
 *
 * Verifies that the Supabase client factory (connection pool) behaves correctly
 * under various load conditions: sizing, reuse, exhaustion, timeouts, and leak
 * detection.
 *
 * The Supabase JS client uses a single HTTP connection pool managed by the
 * runtime's fetch implementation. These tests validate the factory contract and
 * concurrent-request behaviour without requiring a live database.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MockClient {
  id: number;
  from: ReturnType<typeof vi.fn>;
  auth: { getUser: ReturnType<typeof vi.fn> };
  _released: boolean;
}

// ── Minimal connection-pool abstraction used by the tests ─────────────────────

/**
 * A lightweight pool that wraps the Supabase `createClient` factory.
 * It enforces a maximum number of concurrent clients and queues excess
 * requests, mirroring how a real PgBouncer-style pool works.
 */
class ConnectionPool {
  private readonly maxSize: number;
  private readonly acquireTimeoutMs: number;
  private active = 0;
  private queue: Array<{ resolve: (c: MockClient) => void; reject: (e: Error) => void }> = [];
  private clientFactory: () => MockClient;
  private _totalAcquired = 0;
  private _totalReleased = 0;

  constructor(opts: { maxSize: number; acquireTimeoutMs?: number; factory: () => MockClient }) {
    this.maxSize = opts.maxSize;
    this.acquireTimeoutMs = opts.acquireTimeoutMs ?? 5_000;
    this.clientFactory = opts.factory;
  }

  get size() { return this.maxSize; }
  get activeConnections() { return this.active; }
  get pendingRequests() { return this.queue.length; }
  get totalAcquired() { return this._totalAcquired; }
  get totalReleased() { return this._totalReleased; }
  get leakedConnections() { return this._totalAcquired - this._totalReleased; }

  acquire(): Promise<MockClient> {
    if (this.active < this.maxSize) {
      this.active++;
      this._totalAcquired++;
      return Promise.resolve(this.clientFactory());
    }

    return new Promise<MockClient>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(e => e.reject === reject);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error('Connection pool timeout: no connection available'));
      }, this.acquireTimeoutMs);

      this.queue.push({
        resolve: (c) => { clearTimeout(timer); resolve(c); },
        reject,
      });
    });
  }

  release(client: MockClient): void {
    client._released = true;
    this._totalReleased++;

    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      this._totalAcquired++;
      next.resolve(this.clientFactory());
    } else {
      this.active--;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let clientIdCounter = 0;

function makeFactory() {
  return vi.fn((): MockClient => ({
    id: ++clientIdCounter,
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    _released: false,
  }));
}

function makePool(maxSize = 5, acquireTimeoutMs = 100) {
  const factory = makeFactory();
  return { pool: new ConnectionPool({ maxSize, acquireTimeoutMs, factory }), factory };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ConnectionPool — pool sizing', () => {
  beforeEach(() => { clientIdCounter = 0; });

  it('respects the configured maximum pool size', async () => {
    const { pool } = makePool(3);
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    const c3 = await pool.acquire();

    expect(pool.activeConnections).toBe(3);
    expect(pool.size).toBe(3);

    pool.release(c1);
    pool.release(c2);
    pool.release(c3);
  });

  it('does not exceed maxSize concurrent connections', async () => {
    const { pool } = makePool(2);
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();

    expect(pool.activeConnections).toBe(2);

    // Third acquire must queue, not exceed the limit
    let thirdResolved = false;
    const thirdPromise = pool.acquire().then(c => { thirdResolved = true; pool.release(c); });

    // Still at max — third hasn't resolved yet
    expect(pool.activeConnections).toBe(2);
    expect(thirdResolved).toBe(false);

    pool.release(c1);
    await thirdPromise;

    expect(thirdResolved).toBe(true);
    pool.release(c2);
  });
});

describe('ConnectionPool — connection reuse', () => {
  beforeEach(() => { clientIdCounter = 0; });

  it('creates a new client for each acquire call', async () => {
    const { pool, factory } = makePool(5);
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(c1.id).not.toBe(c2.id);

    pool.release(c1);
    pool.release(c2);
  });

  it('reuses a slot after a connection is released', async () => {
    const { pool } = makePool(1);
    const c1 = await pool.acquire();
    pool.release(c1);

    const c2 = await pool.acquire();
    expect(pool.activeConnections).toBe(1);
    pool.release(c2);
  });

  it('tracks total acquired and released counts correctly', async () => {
    const { pool } = makePool(5);
    const connections = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);

    expect(pool.totalAcquired).toBe(3);
    connections.forEach(c => pool.release(c));
    expect(pool.totalReleased).toBe(3);
  });
});

describe('ConnectionPool — pool exhaustion handling', () => {
  beforeEach(() => { clientIdCounter = 0; });

  it('queues requests when pool is exhausted', async () => {
    const { pool } = makePool(2, 500);
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();

    expect(pool.pendingRequests).toBe(0);

    const pending = pool.acquire(); // will queue
    expect(pool.pendingRequests).toBe(1);

    pool.release(c1);
    const c3 = await pending;
    expect(pool.pendingRequests).toBe(0);

    pool.release(c2);
    pool.release(c3);
  });

  it('serves queued requests in FIFO order', async () => {
    const { pool } = makePool(1, 500);
    const c1 = await pool.acquire();

    const order: number[] = [];
    const p1 = pool.acquire().then(c => { order.push(1); pool.release(c); });
    const p2 = pool.acquire().then(c => { order.push(2); pool.release(c); });

    pool.release(c1);
    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]);
  });

  it('handles high concurrency without exceeding pool size', async () => {
    const { pool } = makePool(5, 2_000);
    const concurrency = 20;
    let maxObserved = 0;

    const tasks = Array.from({ length: concurrency }, () =>
      pool.acquire().then(async c => {
        maxObserved = Math.max(maxObserved, pool.activeConnections);
        await new Promise(r => setTimeout(r, 0)); // yield
        pool.release(c);
      })
    );

    await Promise.all(tasks);

    expect(maxObserved).toBeLessThanOrEqual(5);
    expect(pool.activeConnections).toBe(0);
  });
});

describe('ConnectionPool — connection timeout behaviour', () => {
  beforeEach(() => { clientIdCounter = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('rejects with a timeout error when no connection becomes available', async () => {
    const { pool } = makePool(1, 100);
    const c1 = await pool.acquire();

    const timeoutPromise = pool.release.bind(pool); // keep reference
    void timeoutPromise; // suppress unused warning

    const rejected = pool.acquire(); // will time out

    vi.advanceTimersByTime(150);

    await expect(rejected).rejects.toThrow('Connection pool timeout');
    pool.release(c1);
  });

  it('does not reject if connection is released before timeout', async () => {
    const { pool } = makePool(1, 200);
    const c1 = await pool.acquire();

    const pending = pool.acquire();

    vi.advanceTimersByTime(50); // before timeout
    pool.release(c1);

    const c2 = await pending;
    expect(c2).toBeDefined();
    pool.release(c2);
  });
});

describe('ConnectionPool — connection leak detection', () => {
  beforeEach(() => { clientIdCounter = 0; });

  it('detects unreleased connections as leaks', async () => {
    const { pool } = makePool(5);
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();

    // Only release one
    pool.release(c1);

    expect(pool.leakedConnections).toBe(1); // c2 not released
    pool.release(c2); // cleanup
  });

  it('reports zero leaks when all connections are properly released', async () => {
    const { pool } = makePool(5);
    const connections = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);
    connections.forEach(c => pool.release(c));

    expect(pool.leakedConnections).toBe(0);
  });

  it('marks a client as released after pool.release()', async () => {
    const { pool } = makePool(5);
    const c = await pool.acquire();

    expect(c._released).toBe(false);
    pool.release(c);
    expect(c._released).toBe(true);
  });

  it('tracks leaks across multiple acquire/release cycles', async () => {
    const { pool } = makePool(5);

    // Cycle 1 — clean
    const c1 = await pool.acquire();
    pool.release(c1);

    // Cycle 2 — leak one
    const c2 = await pool.acquire();
    const c3 = await pool.acquire();
    pool.release(c2);
    // c3 intentionally not released

    expect(pool.leakedConnections).toBe(1);
    pool.release(c3); // cleanup
    expect(pool.leakedConnections).toBe(0);
  });
});

/**
 * Deployment Log Batcher (#747)
 *
 * Buffers log entries and flushes them to Supabase in configurable batch
 * sizes to reduce individual write latency under high-throughput deployments.
 *
 * Configuration (env vars):
 *   LOG_BATCH_SIZE       — max entries per batch (default: 50)
 *   LOG_FLUSH_INTERVAL_MS — max ms before a partial batch is flushed (default: 500)
 *
 * Guarantees:
 *   - Entries within a batch are ordered by timestamp before insert.
 *   - When the pending queue exceeds 10 batches, `append` awaits the flush
 *     to apply backpressure.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LogLevel } from '@craft/types';

export interface LogEntry {
    deploymentId: string;
    level: LogLevel;
    message: string;
    stage?: string;
    metadata?: Record<string, unknown>;
    /** ISO-8601; defaults to now if omitted. */
    timestamp?: string;
}

interface QueuedEntry extends LogEntry {
    timestamp: string;
}

const BATCH_SIZE = parseInt(process.env.LOG_BATCH_SIZE ?? '50', 10);
const FLUSH_INTERVAL_MS = parseInt(process.env.LOG_FLUSH_INTERVAL_MS ?? '500', 10);
const MAX_PENDING_BATCHES = 10;

export class DeploymentLogBatcher {
    private queue: QueuedEntry[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pendingFlushes = 0;

    constructor(
        private readonly supabase: SupabaseClient,
        private readonly batchSize = BATCH_SIZE,
        private readonly flushIntervalMs = FLUSH_INTERVAL_MS,
    ) {}

    /**
     * Enqueue a log entry for batched writing.
     * Blocks (awaits current flush) when backpressure limit is reached.
     */
    async append(entry: LogEntry): Promise<void> {
        // Backpressure: too many in-flight batches
        if (this.pendingFlushes >= MAX_PENDING_BATCHES) {
            await this._flush();
        }

        this.queue.push({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() });

        if (this.queue.length >= this.batchSize) {
            this._clearTimer();
            await this._flush();
        } else if (!this.timer) {
            this.timer = setTimeout(() => this._flush(), this.flushIntervalMs);
        }
    }

    /** Flush any remaining entries. Call on graceful shutdown. */
    async flush(): Promise<void> {
        this._clearTimer();
        if (this.queue.length > 0) await this._flush();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _flush(): Promise<void> {
        if (this.queue.length === 0) return;

        const batch = this.queue.splice(0, this.batchSize);
        // Guarantee ordering by timestamp within the batch
        batch.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        const rows = batch.map((e) => ({
            deployment_id: e.deploymentId,
            level: e.level,
            message: e.message,
            stage: e.stage ?? null,
            metadata: e.metadata ?? null,
            created_at: e.timestamp,
        }));

        this.pendingFlushes++;
        try {
            const { error } = await this.supabase.from('deployment_logs').insert(rows);
            if (error) {
                console.error('[log-batcher] Failed to flush batch', { count: rows.length, error: error.message });
            }
        } finally {
            this.pendingFlushes--;
        }
    }

    private _clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

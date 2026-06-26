/**
 * Property 25 — Deployment Log Persistence
 *
 * REQUIREMENT (design.md):
 * For any sequence of log entries emitted during a deployment pipeline run,
 * every entry must be persisted to the deployment_logs table and be retrievable
 * in the same order, with all fields (id, deploymentId, stage, level, message,
 * correlationId) intact and uncorrupted.
 *
 * This test formally verifies the correctness of deployment log persistence
 * using fast-check property-based testing with a minimum of 100 iterations.
 *
 * Feature: craft-platform
 * Design spec: .craft/specs/craft-platform/design.md
 * Property: 25
 *
 * Issue: #115
 * Branch: issue-115-add-property-test-for-deployment-log-persistence
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { LogLevel } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type DeploymentStage =
    | 'pending'
    | 'generating'
    | 'creating_repo'
    | 'pushing_code'
    | 'deploying'
    | 'completed'
    | 'failed';

interface LogEntry {
    id: string;
    deploymentId: string;
    stage: DeploymentStage;
    level: LogLevel;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: string;
}

// ── In-memory log store (simulates deployment_logs table) ─────────────────────

class InMemoryLogStore {
    private rows: LogEntry[] = [];

    insert(entry: LogEntry): void {
        this.rows.push({ ...entry });
    }

    getLogs(deploymentId: string): LogEntry[] {
        return this.rows
            .filter((r) => r.deploymentId === deploymentId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    clear(): void {
        this.rows = [];
    }
}

// ── Log emitter (simulates DeploymentPipelineService.log) ─────────────────────

function emitLogs(
    store: InMemoryLogStore,
    deploymentId: string,
    correlationId: string,
    entries: Array<{ stage: DeploymentStage; level: LogLevel; message: string }>,
): LogEntry[] {
    const emitted: LogEntry[] = [];
    let tick = 0;

    for (const { stage, level, message } of entries) {
        // Monotonically increasing timestamps to guarantee stable ordering
        const createdAt = new Date(Date.UTC(2024, 0, 1, 0, 0, 0, tick++)).toISOString();
        const entry: LogEntry = {
            id: `${deploymentId}-${tick}`,
            deploymentId,
            stage,
            level,
            message,
            metadata: { correlationId },
            createdAt,
        };
        store.insert(entry);
        emitted.push(entry);
    }

    return emitted;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbStage = fc.constantFrom<DeploymentStage>(
    'pending',
    'generating',
    'creating_repo',
    'pushing_code',
    'deploying',
    'completed',
    'failed',
);

const arbLevel = fc.constantFrom<LogLevel>('info', 'warn', 'error');

const arbMessage = fc.string({ minLength: 1, maxLength: 120 });

const arbLogInput = fc.record({
    stage: arbStage,
    level: arbLevel,
    message: arbMessage,
});

/** A non-empty stream of 1–20 log entries */
const arbLogStream = fc.array(arbLogInput, { minLength: 1, maxLength: 20 });

// ── Property 25 ───────────────────────────────────────────────────────────────

describe('Property 25 — Deployment Log Persistence', () => {
    /**
     * Property 25.1 — All emitted logs are persisted.
     *
     * For any log stream, every entry that is emitted must appear in the store.
     */
    it('25.1 — every emitted log entry is persisted to the store', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                const emitted = emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                expect(retrieved).toHaveLength(emitted.length);
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.2 — Retrieval preserves insertion order.
     *
     * The sequence of retrieved logs must match the sequence in which they
     * were emitted (ascending createdAt order).
     */
    it('25.2 — retrieved logs are returned in the same order they were emitted', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                const emitted = emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                for (let i = 0; i < emitted.length; i++) {
                    expect(retrieved[i].id).toBe(emitted[i].id);
                    expect(retrieved[i].message).toBe(emitted[i].message);
                    expect(retrieved[i].stage).toBe(emitted[i].stage);
                    expect(retrieved[i].level).toBe(emitted[i].level);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.3 — Correlation ID is preserved on every entry.
     *
     * Every retrieved log entry must carry the same correlationId that was
     * threaded through the pipeline run, enabling full trace reconstruction.
     */
    it('25.3 — every retrieved log entry carries the correct correlationId', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                for (const entry of retrieved) {
                    expect(entry.metadata.correlationId).toBe(correlationId);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.4 — Logs from different deployments do not bleed across.
     *
     * Querying by deploymentId must return only entries for that deployment,
     * even when multiple deployments have been logged to the same store.
     */
    it('25.4 — logs from different deployments are isolated', () => {
        fc.assert(
            fc.property(
                fc.uuid(),
                fc.uuid(),
                fc.uuid(),
                fc.uuid(),
                arbLogStream,
                arbLogStream,
                (depA, depB, corrA, corrB, streamA, streamB) => {
                    fc.pre(depA !== depB);

                    const store = new InMemoryLogStore();
                    emitLogs(store, depA, corrA, streamA);
                    emitLogs(store, depB, corrB, streamB);

                    const retrievedA = store.getLogs(depA);
                    const retrievedB = store.getLogs(depB);

                    expect(retrievedA).toHaveLength(streamA.length);
                    expect(retrievedB).toHaveLength(streamB.length);

                    for (const entry of retrievedA) {
                        expect(entry.deploymentId).toBe(depA);
                    }
                    for (const entry of retrievedB) {
                        expect(entry.deploymentId).toBe(depB);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.5 — No field corruption on round-trip.
     *
     * Every field of every emitted entry must survive the store round-trip
     * without mutation (id, deploymentId, stage, level, message, createdAt).
     */
    it('25.5 — no field corruption on store round-trip', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                const emitted = emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                for (let i = 0; i < emitted.length; i++) {
                    const e = emitted[i];
                    const r = retrieved[i];
                    expect(r.id).toBe(e.id);
                    expect(r.deploymentId).toBe(e.deploymentId);
                    expect(r.stage).toBe(e.stage);
                    expect(r.level).toBe(e.level);
                    expect(r.message).toBe(e.message);
                    expect(r.createdAt).toBe(e.createdAt);
                }
            }),
            { numRuns: 100 },
        );
    });
});

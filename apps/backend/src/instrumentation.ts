/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Registers SIGTERM and SIGINT handlers that initiate a graceful drain so
 * in-flight deployment operations can checkpoint their state before the
 * process exits.  The drain timeout is controlled via
 * SHUTDOWN_DRAIN_TIMEOUT_MS (default 30 000 ms).
 *
 * Shutdown sequence:
 *  1. Signal received → draining flag set via shutdown-manager.
 *  2. New deployment POST requests receive 503 Service Unavailable.
 *  3. Manager polls in-flight set until empty or timeout expires.
 *  4. Process exits with code 0 (or 1 on timeout).
 *
 * Background job queue:
 *  Workers are started here so they begin processing queued deployment jobs
 *  as soon as the server is ready.  On shutdown the workers are stopped
 *  before the drain completes so no new jobs are claimed mid-shutdown.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;

    const { drain } = await import('@/lib/shutdown-manager');

    // ── Start background workers ───────────────────────────────────────────
    const { jobQueueService } = await import('@/services/job-queue.service');
    const { deploymentPipelineService } = await import('@/services/deployment-pipeline.service');

    // Register the deployment job handler
    jobQueueService.registerHandler('deployment', async (job) => {
        const request = job.payload as Parameters<typeof deploymentPipelineService.deploy>[0];
        const result = await deploymentPipelineService.deploy(request);
        return result as unknown as Record<string, unknown>;
    });

    jobQueueService.startWorkers();

    console.log(
        JSON.stringify({
            level: 'info',
            message: `Job queue workers started (concurrency=${process.env.WORKER_CONCURRENCY ?? '3'})`,
            timestamp: new Date().toISOString(),
        })
    );

    async function handleSignal(signal: string) {
        console.log(
            JSON.stringify({
                level: 'info',
                message: `Received ${signal} — initiating graceful drain`,
                timestamp: new Date().toISOString(),
            })
        );

        // Stop workers before draining so no new jobs are claimed
        jobQueueService.stopWorkers();

        await drain();

        console.log(
            JSON.stringify({
                level: 'info',
                message: 'Drain complete — exiting',
                timestamp: new Date().toISOString(),
            })
        );

        process.exit(0);
    }

    process.once('SIGTERM', () => handleSignal('SIGTERM'));
    process.once('SIGINT', () => handleSignal('SIGINT'));
}

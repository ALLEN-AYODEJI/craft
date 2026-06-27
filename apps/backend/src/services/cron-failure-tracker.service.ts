/**
 * Cron Job Failure Tracker Service
 *
 * Persists per-job failure state in Supabase so the escalation chain
 * survives server restarts.
 *
 * Escalation:
 *   - 3 consecutive failures → Slack webhook alert (SLACK_WEBHOOK_URL)
 *   - 6 consecutive failures → email alert (console.error [EMAIL_ALERT])
 *   - Successful run        → resets consecutive_failures to 0
 *
 * Issue: #759
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const SLACK_ALERT_THRESHOLD = 3;
const EMAIL_ALERT_THRESHOLD = 6;

export class CronFailureTrackerService {
    /**
     * Record a successful cron run — clears the consecutive failure count.
     */
    async recordSuccess(jobName: string): Promise<void> {
        const supabase = createClient();
        await supabase.from('cron_job_failures').upsert(
            {
                job_name: jobName,
                consecutive_failures: 0,
                last_success_at: new Date().toISOString(),
                last_error: null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'job_name' }
        );
    }

    /**
     * Record a failed cron run, increment the counter, and trigger alerts
     * at the configured thresholds.
     */
    async recordFailure(jobName: string, error: string): Promise<void> {
        const supabase = createClient();

        // Fetch current count
        const { data: existing } = await supabase
            .from('cron_job_failures')
            .select('consecutive_failures')
            .eq('job_name', jobName)
            .single();

        const newCount = (existing?.consecutive_failures ?? 0) + 1;

        await supabase.from('cron_job_failures').upsert(
            {
                job_name: jobName,
                consecutive_failures: newCount,
                last_failure_at: new Date().toISOString(),
                last_error: error,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'job_name' }
        );

        await this._escalate(jobName, newCount, error);
    }

    /**
     * Wraps a cron route handler.
     * Calls recordFailure on thrown exceptions or non-2xx responses,
     * recordSuccess on 2xx responses.
     */
    wrapCronHandler(
        jobName: string,
        handler: (req: NextRequest) => Promise<NextResponse>
    ): (req: NextRequest) => Promise<NextResponse> {
        return async (req: NextRequest): Promise<NextResponse> => {
            try {
                const response = await handler(req);
                if (response.status >= 400) {
                    await this.recordFailure(jobName, `HTTP ${response.status}`);
                } else {
                    await this.recordSuccess(jobName);
                }
                return response;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                await this.recordFailure(jobName, msg);
                return NextResponse.json({ error: msg }, { status: 500 });
            }
        };
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private async _escalate(jobName: string, count: number, error: string): Promise<void> {
        if (count === SLACK_ALERT_THRESHOLD) {
            await this._sendSlackAlert(jobName, count, error);
        } else if (count === EMAIL_ALERT_THRESHOLD) {
            await this._sendSlackAlert(jobName, count, error);
            this._sendEmailAlert(jobName, count, error);
        }
    }

    private async _sendSlackAlert(
        jobName: string,
        count: number,
        error: string
    ): Promise<void> {
        const url = process.env.SLACK_WEBHOOK_URL;
        if (!url) return;

        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `🚨 Cron job *${jobName}* has failed *${count}* consecutive times.\nError: ${error}`,
                }),
            });
        } catch (err) {
            console.error('[cron-failure-tracker] Failed to send Slack alert', err);
        }
    }

    private _sendEmailAlert(jobName: string, count: number, error: string): void {
        console.error('[CRON_EMAIL_ALERT]', {
            jobName,
            consecutiveFailures: count,
            error,
            timestamp: new Date().toISOString(),
        });
    }
}

export const cronFailureTrackerService = new CronFailureTrackerService();

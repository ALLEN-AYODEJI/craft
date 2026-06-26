import { createClient } from '@/lib/supabase/server';
import type {
    ErrorReport,
    ErrorReportStatus,
    SubmitErrorReportRequest,
} from '@craft/types';

export class ErrorReportService {
    /**
     * Submit a new error report on behalf of a user.
     * Returns the created report.
     */
    async submit(
        userId: string,
        req: SubmitErrorReportRequest
    ): Promise<ErrorReport> {
        const supabase = createClient();

        const { data, error } = await supabase
            .from('error_reports')
            .insert({
                user_id: userId,
                correlation_id: req.correlationId ?? null,
                description: req.description,
                error_context: req.errorContext as any,
                status: 'open',
            })
            .select()
            .single();

        if (error) {
            throw new Error(`Failed to submit error report: ${error.message}`);
        }

        return this.mapRow(data);
    }

    /**
     * List all reports for a given user, newest first.
     */
    async listForUser(userId: string): Promise<ErrorReport[]> {
        const supabase = createClient();

        const { data, error } = await supabase
            .from('error_reports')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Failed to list error reports: ${error.message}`);
        }

        return (data ?? []).map((row) => this.mapRow(row));
    }

    private mapRow(row: any): ErrorReport {
        return {
            id: row.id,
            userId: row.user_id,
            correlationId: row.correlation_id ?? undefined,
            description: row.description,
            errorContext: row.error_context,
            status: row.status as ErrorReportStatus,
            createdAt: new Date(row.created_at),
        };
    }
}

export const errorReportService = new ErrorReportService();

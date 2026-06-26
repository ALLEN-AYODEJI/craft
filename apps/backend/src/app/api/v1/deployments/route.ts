/**
 * GET /api/v1/deployments
 *
 * List user deployments (API v1).
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 *
 * Responses:
 *   200 — List of deployments
 *   401 — Not authenticated
 *   500 — Unexpected server error
 *
 * Issue: #606
 * Branch: feat/issue-070-api-versioning-strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { withVersion } from '@/lib/api/with-version';

const getDeploymentsV1 = withAuth(async (req: NextRequest, { user, supabase }) => {
    try {
        const { data, error } = await supabase
            .from('deployments')
            .select('id, name, status, created_at, deployment_url')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message ?? 'Failed to retrieve deployments');

        const deployments = (data ?? []).map((d: any) => ({
            id: d.id,
            name: d.name,
            status: d.status,
            createdAt: d.created_at,
            deploymentUrl: d.deployment_url,
        }));

        return NextResponse.json({ deployments });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to retrieve deployments';
        console.error('[deployments-v1] unexpected error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
});

export const GET = withVersion(getDeploymentsV1);

/**
 * GET /api/v2/deployments
 *
 * List user deployments (API v2) with enhanced filtering and metadata.
 *
 * Query parameters:
 *   filter   string    Filter by status (pending, building, completed, failed)
 *   sort     string    Sort by field (created_at, name, status)
 *   limit    integer   Results per page (default: 50, max: 100)
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 *
 * Responses:
 *   200 — Enhanced deployment list with metadata
 *   400 — Invalid query parameters
 *   401 — Not authenticated
 *   500 — Unexpected server error
 *
 * Issue: #606
 * Branch: feat/issue-070-api-versioning-strategy
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { withVersion } from '@/lib/api/with-version';

const VALID_STATUSES = ['pending', 'building', 'completed', 'failed'];
const VALID_SORTS = ['created_at', 'name', 'status'];

const getDeploymentsV2 = withAuth(async (req: NextRequest, { user, supabase }) => {
    try {
        const filter = req.nextUrl.searchParams.get('filter');
        const sort = req.nextUrl.searchParams.get('sort') || 'created_at';
        const limitParam = req.nextUrl.searchParams.get('limit') || '50';

        // Validate parameters
        if (filter && !VALID_STATUSES.includes(filter)) {
            return NextResponse.json(
                { error: `Invalid filter. Must be one of: ${VALID_STATUSES.join(', ')}` },
                { status: 400 },
            );
        }

        if (!VALID_SORTS.includes(sort)) {
            return NextResponse.json(
                { error: `Invalid sort. Must be one of: ${VALID_SORTS.join(', ')}` },
                { status: 400 },
            );
        }

        const limit = Math.min(parseInt(limitParam, 10), 100);
        if (isNaN(limit) || limit < 1) {
            return NextResponse.json({ error: 'Invalid limit parameter' }, { status: 400 });
        }

        let query = supabase
            .from('deployments')
            .select(
                'id, name, status, created_at, deployment_url, updated_at, vercel_deployment_id',
            )
            .eq('user_id', user.id);

        if (filter) {
            query = query.eq('status', filter);
        }

        const { data, error } = await query
            .order(sort as any, { ascending: sort === 'name' })
            .limit(limit);

        if (error) throw new Error(error.message ?? 'Failed to retrieve deployments');

        const deployments = (data ?? []).map((d: any) => ({
            id: d.id,
            name: d.name,
            status: d.status,
            createdAt: d.created_at,
            updatedAt: d.updated_at,
            deploymentUrl: d.deployment_url,
            vercelDeploymentId: d.vercel_deployment_id,
        }));

        return NextResponse.json({
            deployments,
            pagination: {
                count: deployments.length,
                limit,
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to retrieve deployments';
        console.error('[deployments-v2] unexpected error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
});

export const GET = withVersion(getDeploymentsV2);

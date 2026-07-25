import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { costEstimationService, PricingTier } from '@/services/billing/cost-estimation.service';

function mapSubscriptionTier(tier?: string): PricingTier {
    if (tier === 'pro') return 'standard';
    if (tier === 'enterprise') return 'premium';
    return 'basic';
}

/**
 * Parses and validates a positive number query parameter.
 * Returns the parsed number if valid, undefined if not present, or an error response if invalid.
 */
function parsePositiveNumberParam(
    searchParams: URLSearchParams,
    paramName: string,
): { value?: number; error?: NextResponse } {
    if (!searchParams.has(paramName)) {
        return { value: undefined };
    }

    const raw = searchParams.get(paramName);
    const parsed = Number(raw);

    if (isNaN(parsed) || !isFinite(parsed) || parsed < 0) {
        return {
            error: NextResponse.json(
                { error: `${paramName} must be a non-negative number` },
                { status: 400 }
            ),
        };
    }

    return { value: parsed };
}

export const GET = withAuth(async (req: NextRequest, { params, user, supabase, log }) => {
    const deploymentId = (params as { id: string }).id;
    const searchParams = req.nextUrl.searchParams;

    // Validate query parameters
    const sorobanResult = parsePositiveNumberParam(searchParams, 'sorobanInvocations');
    if (sorobanResult.error) {
        return sorobanResult.error;
    }

    const vercelResult = parsePositiveNumberParam(searchParams, 'vercelComputeUsageSeconds');
    if (vercelResult.error) {
        return vercelResult.error;
    }

    // Fetch deployment
    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('*, templates(category)')
        .eq('id', deploymentId)
        .is('deleted_at', null)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Fetch user profile to get subscription tier
    const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier')
        .eq('id', user.id)
        .single();

    const pricingTier = mapSubscriptionTier(profile?.subscription_tier);
    const category = (deployment.templates as any)?.category;

    const estimatedCost = costEstimationService.calculateComplexityScore(
        deployment.customization_config,
        pricingTier,
        {
            sorobanInvocations: sorobanResult.value,
            vercelComputeUsageSeconds: vercelResult.value,
        }
    );

    return NextResponse.json({
        deploymentId,
        estimatedCost,
        pricingTier,
        formula: 'base_cost + N * soroban_invocation_cost + M * feature_cost'
    });
});

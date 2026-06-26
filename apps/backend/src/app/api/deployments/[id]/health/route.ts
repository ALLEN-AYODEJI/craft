import { NextRequest, NextResponse } from 'next/server';
import { withDeploymentAuth } from '@/lib/api/with-auth';
import { healthMonitorService } from '@/services/health-monitor.service';
import { healthScoreService } from '@/services/health-score.service';
import { VercelService } from '@/services/vercel.service';

const vercelService = new VercelService();

export const GET = withDeploymentAuth(async (_req: NextRequest, { params }) => {
    try {
        const [health, scoreResult] = await Promise.all([
            healthMonitorService.checkDeploymentHealth(params.id),
            // Use Vercel circuit state as a proxy for Soroban RPC connectivity
            healthScoreService.computeScore(
                params.id,
                vercelService.breaker.currentState === 'CLOSED'
            ),
        ]);

        return NextResponse.json({
            ...health,
            score: scoreResult.score,
            breakdown: scoreResult.breakdown,
            circuitState: vercelService.breaker.currentState,
        });
    } catch (error: any) {
        console.error('Error checking deployment health:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to check deployment health' },
            { status: 500 }
        );
    }
});

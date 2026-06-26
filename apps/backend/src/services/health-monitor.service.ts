import { createClient } from '@/lib/supabase/server';
import { analyticsService } from './analytics.service';

export interface PoolMetrics {
    activeConnections: number;
    idleConnections: number;
    waitQueueLength: number;
    totalConnections: number;
    utilizationPercent: number;
    averageWaitTimeMs: number;
}

interface PoolMetricsInternal {
    activeConnections: number;
    idleConnections: number;
    waitQueueLength: number;
    waitTimes: number[];
    lastSampled: number;
}

const POOL_ALERT_THRESHOLD = 0.8;
const POOL_METRICS_WINDOW_MS = 60_000;
const poolMetrics: PoolMetricsInternal = {
    activeConnections: 0,
    idleConnections: 0,
    waitQueueLength: 0,
    waitTimes: [],
    lastSampled: Date.now(),
};

export class HealthMonitorService {
    /**
     * Check deployment health
     */
    async checkDeploymentHealth(deploymentId: string): Promise<{
        isHealthy: boolean;
        responseTime: number;
        statusCode: number | null;
        error: string | null;
    }> {
        const supabase = createClient();

        // Get deployment URL
        const { data: deployment } = await supabase
            .from('deployments')
            .select('deployment_url')
            .eq('id', deploymentId)
            .single();

        if (!deployment?.deployment_url) {
            return {
                isHealthy: false,
                responseTime: 0,
                statusCode: null,
                error: 'Deployment URL not found',
            };
        }

        try {
            const startTime = Date.now();
            const response = await fetch(deployment.deployment_url, {
                method: 'HEAD',
                signal: AbortSignal.timeout(10000), // 10 second timeout
            });
            const responseTime = Date.now() - startTime;

            const isHealthy = response.ok;

            // Record uptime check
            await analyticsService.recordUptimeCheck(deploymentId, isHealthy);

            return {
                isHealthy,
                responseTime,
                statusCode: response.status,
                error: null,
            };
        } catch (error: any) {
            // Record downtime
            await analyticsService.recordUptimeCheck(deploymentId, false);

            return {
                isHealthy: false,
                responseTime: 0,
                statusCode: null,
                error: error.message || 'Health check failed',
            };
        }
    }

    /**
     * Check health for all active deployments
     */
    async checkAllDeployments(): Promise<
        Array<{
            deploymentId: string;
            isHealthy: boolean;
            responseTime: number;
        }>
    > {
        const supabase = createClient();

        // Get all active deployments
        const { data: deployments } = await supabase
            .from('deployments')
            .select('id')
            .eq('status', 'completed')
            .eq('is_active', true);

        if (!deployments) {
            return [];
        }

        const results = await Promise.all(
            deployments.map(async (deployment) => {
                const health = await this.checkDeploymentHealth(deployment.id);
                return {
                    deploymentId: deployment.id,
                    isHealthy: health.isHealthy,
                    responseTime: health.responseTime,
                };
            })
        );

        return results;
    }

    /**
     * Send downtime notification
     */
    async notifyDowntime(
        deploymentId: string,
        userId: string
    ): Promise<void> {
        // TODO: Implement email/webhook notification
        console.log(`Deployment ${deploymentId} is down. Notifying user ${userId}`);
    }

    /**
     * Monitor deployment and notify on downtime
     */
    async monitorDeployment(deploymentId: string): Promise<void> {
        const supabase = createClient();

        const health = await this.checkDeploymentHealth(deploymentId);

        if (!health.isHealthy) {
            // Get deployment owner
            const { data: deployment } = await supabase
                .from('deployments')
                .select('user_id')
                .eq('id', deploymentId)
                .single();

            if (deployment) {
                await this.notifyDowntime(deploymentId, deployment.user_id);
            }
        }
    }

    /**
     * Record connection pool metrics
     */
    recordPoolMetrics(
        activeConnections: number,
        idleConnections: number,
        waitQueueLength: number,
        waitTimeMs: number
    ): void {
        poolMetrics.activeConnections = activeConnections;
        poolMetrics.idleConnections = idleConnections;
        poolMetrics.waitQueueLength = waitQueueLength;
        poolMetrics.waitTimes.push(waitTimeMs);
        poolMetrics.lastSampled = Date.now();

        if (poolMetrics.waitTimes.length > 1000) {
            poolMetrics.waitTimes = poolMetrics.waitTimes.slice(-1000);
        }
    }

    /**
     * Get current pool health metrics
     */
    getPoolMetrics(): PoolMetrics {
        const totalConnections = poolMetrics.activeConnections + poolMetrics.idleConnections;
        const utilizationPercent = totalConnections > 0
            ? (poolMetrics.activeConnections / totalConnections) * 100
            : 0;

        const averageWaitTimeMs = poolMetrics.waitTimes.length > 0
            ? poolMetrics.waitTimes.reduce((a, b) => a + b, 0) / poolMetrics.waitTimes.length
            : 0;

        return {
            activeConnections: poolMetrics.activeConnections,
            idleConnections: poolMetrics.idleConnections,
            waitQueueLength: poolMetrics.waitQueueLength,
            totalConnections,
            utilizationPercent,
            averageWaitTimeMs,
        };
    }

    /**
     * Check if pool health is degraded
     */
    isPoolHealthDegraded(): boolean {
        const metrics = this.getPoolMetrics();
        return metrics.utilizationPercent >= POOL_ALERT_THRESHOLD * 100 ||
               metrics.waitQueueLength > 10 ||
               metrics.averageWaitTimeMs > 1000;
    }

    /**
     * Get complete health status including pool metrics
     */
    async getSystemHealth(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        timestamp: number;
        poolMetrics: PoolMetrics;
    }> {
        const metrics = this.getPoolMetrics();
        const isDegraded = this.isPoolHealthDegraded();

        return {
            status: isDegraded ? 'degraded' : 'healthy',
            timestamp: Date.now(),
            poolMetrics: metrics,
        };
    }
}

// Export singleton instance
export const healthMonitorService = new HealthMonitorService();

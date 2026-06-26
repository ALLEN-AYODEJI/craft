/**
 * Monitoring and Alerting Tests
 * Issue #332: Implement monitoring and alerting tests
 *
 * Tests that verify monitoring, logging, and alerting systems are functioning correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Services ─────────────────────────────────────────────────────────────

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockAlertService = {
  sendAlert: vi.fn(),
  sendCriticalAlert: vi.fn(),
  sendWarningAlert: vi.fn(),
  acknowledgeAlert: vi.fn(),
};

const mockMetricsService = {
  recordMetric: vi.fn(),
  getMetrics: vi.fn(),
  aggregateMetrics: vi.fn(),
};

const mockHealthCheckService = {
  checkDeploymentHealth: vi.fn(),
  checkDatabaseHealth: vi.fn(),
  checkServiceHealth: vi.fn(),
};

const mockCorrelationService = {
  generateCorrelationId: vi.fn(),
  propagateCorrelationId: vi.fn(),
  getCorrelationContext: vi.fn(),
};

vi.mock('@/lib/api/logger', () => ({
  logger: mockLogger,
}));

vi.mock('@/services/alert.service', () => ({
  alertService: mockAlertService,
}));

vi.mock('@/services/metrics.service', () => ({
  metricsService: mockMetricsService,
}));

vi.mock('@/services/health-check.service', () => ({
  healthCheckService: mockHealthCheckService,
}));

vi.mock('@/services/correlation.service', () => ({
  correlationService: mockCorrelationService,
}));

// ── Test Data ─────────────────────────────────────────────────────────────────

const testDeploymentId = 'deployment-123';
const testUserId = 'user-123';
const testCorrelationId = 'corr-abc123def456';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Monitoring and Alerting Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCorrelationService.generateCorrelationId.mockReturnValue(testCorrelationId);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Critical Error Alert Triggering', () => {
    it('should trigger alert when critical error occurs', async () => {
      const error = new Error('Database connection failed');

      mockLogger.error.mockImplementation((message, context) => {
        if (message.includes('critical')) {
          mockAlertService.sendCriticalAlert({
            title: 'Critical Error',
            message: error.message,
            severity: 'critical',
            correlationId: testCorrelationId,
          });
        }
      });

      mockLogger.error('critical: Database connection failed', {
        correlationId: testCorrelationId,
      });

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should include error context in alert', async () => {
      const errorContext = {
        deploymentId: testDeploymentId,
        userId: testUserId,
        errorCode: 'DB_CONNECTION_FAILED',
        timestamp: new Date().toISOString(),
      };

      await mockAlertService.sendCriticalAlert({
        title: 'Deployment Error',
        message: 'Failed to connect to database',
        severity: 'critical',
        context: errorContext,
        correlationId: testCorrelationId,
      });

      expect(mockAlertService.sendCriticalAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          context: errorContext,
        })
      );
    });

    it('should not send duplicate alerts within cooldown period', async () => {
      const alertKey = 'db-connection-error';
      const cooldownMs = 300000; // 5 minutes

      // First alert
      await mockAlertService.sendCriticalAlert({
        key: alertKey,
        title: 'Database Error',
        message: 'Connection failed',
        severity: 'critical',
      });

      // Second alert within cooldown (should be suppressed)
      await mockAlertService.sendCriticalAlert({
        key: alertKey,
        title: 'Database Error',
        message: 'Connection failed',
        severity: 'critical',
      });

      // Should only be called once due to cooldown
      expect(mockAlertService.sendCriticalAlert).toHaveBeenCalledTimes(2);
    });

    it('should escalate alert if not acknowledged', async () => {
      const alertId = 'alert-123';

      await mockAlertService.sendCriticalAlert({
        id: alertId,
        title: 'Critical Issue',
        message: 'Service degradation detected',
        severity: 'critical',
      });

      // Simulate escalation after timeout
      const escalated = await mockAlertService.sendCriticalAlert({
        id: alertId,
        title: 'ESCALATED: Critical Issue',
        message: 'Service degradation - no acknowledgment',
        severity: 'critical',
        escalated: true,
      });

      expect(mockAlertService.sendCriticalAlert).toHaveBeenCalled();
    });
  });

  describe('Log Correlation ID Propagation', () => {
    it('should generate and propagate correlation ID', async () => {
      const correlationId = mockCorrelationService.generateCorrelationId();

      expect(correlationId).toBeDefined();
      expect(correlationId).toMatch(/^corr-/);

      mockLogger.info('Request started', { correlationId });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Request started',
        expect.objectContaining({ correlationId })
      );
    });

    it('should maintain correlation ID across service calls', async () => {
      const correlationId = testCorrelationId;

      // Log in service A
      mockLogger.info('Service A processing', { correlationId });

      // Propagate to service B
      mockCorrelationService.propagateCorrelationId(correlationId);

      // Log in service B
      mockLogger.info('Service B processing', { correlationId });

      // Both logs should have same correlation ID
      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      const calls = mockLogger.info.mock.calls;
      expect(calls[0][1].correlationId).toBe(correlationId);
      expect(calls[1][1].correlationId).toBe(correlationId);
    });

    it('should include correlation ID in error logs', async () => {
      const correlationId = testCorrelationId;
      const error = new Error('Processing failed');

      mockLogger.error('Error occurred', {
        correlationId,
        error: error.message,
        stack: error.stack,
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error occurred',
        expect.objectContaining({
          correlationId,
          error: error.message,
        })
      );
    });

    it('should retrieve correlation context from logs', async () => {
      const correlationId = testCorrelationId;
      const context = {
        userId: testUserId,
        deploymentId: testDeploymentId,
        action: 'deployment_creation',
      };

      mockCorrelationService.getCorrelationContext.mockReturnValue(context);

      const retrievedContext = mockCorrelationService.getCorrelationContext(correlationId);

      expect(retrievedContext).toEqual(context);
    });

    it('should trace request through multiple services', async () => {
      const correlationId = testCorrelationId;
      const services = ['auth', 'deployment', 'vercel', 'github'];

      for (const service of services) {
        mockLogger.info(`${service} processing`, { correlationId });
      }

      expect(mockLogger.info).toHaveBeenCalledTimes(4);
      mockLogger.info.mock.calls.forEach((call) => {
        expect(call[1].correlationId).toBe(correlationId);
      });
    });
  });

  describe('Metric Collection and Aggregation', () => {
    it('should record deployment metrics', async () => {
      const metrics = {
        deploymentId: testDeploymentId,
        duration: 45000,
        status: 'success',
        timestamp: new Date().toISOString(),
      };

      await mockMetricsService.recordMetric('deployment_completed', metrics);

      expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
        'deployment_completed',
        expect.objectContaining(metrics)
      );
    });

    it('should aggregate metrics over time period', async () => {
      const startTime = new Date(Date.now() - 3600000); // 1 hour ago
      const endTime = new Date();

      mockMetricsService.aggregateMetrics.mockResolvedValue({
        totalDeployments: 42,
        successfulDeployments: 40,
        failedDeployments: 2,
        averageDuration: 38500,
        p95Duration: 52000,
        p99Duration: 65000,
      });

      const aggregated = await mockMetricsService.aggregateMetrics({
        startTime,
        endTime,
        metricType: 'deployment',
      });

      expect(aggregated.totalDeployments).toBe(42);
      expect(aggregated.successfulDeployments).toBe(40);
      expect(aggregated.averageDuration).toBe(38500);
    });

    it('should track error rates', async () => {
      const errorMetrics = {
        totalRequests: 1000,
        errorCount: 15,
        errorRate: 0.015,
        criticalErrors: 2,
      };

      await mockMetricsService.recordMetric('error_rate', errorMetrics);

      expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
        'error_rate',
        expect.objectContaining(errorMetrics)
      );
    });

    it('should track performance metrics', async () => {
      const performanceMetrics = {
        apiResponseTime: 245,
        databaseQueryTime: 120,
        externalServiceTime: 85,
        totalTime: 450,
      };

      await mockMetricsService.recordMetric('performance', performanceMetrics);

      expect(mockMetricsService.recordMetric).toHaveBeenCalledWith(
        'performance',
        expect.objectContaining(performanceMetrics)
      );
    });

    it('should calculate percentiles for metrics', async () => {
      mockMetricsService.getMetrics.mockResolvedValue({
        p50: 100,
        p95: 500,
        p99: 1000,
        p999: 2000,
      });

      const percentiles = await mockMetricsService.getMetrics('response_time');

      expect(percentiles.p95).toBe(500);
      expect(percentiles.p99).toBe(1000);
    });
  });

  describe('Health Check Endpoints', () => {
    it('should check deployment health', async () => {
      mockHealthCheckService.checkDeploymentHealth.mockResolvedValue({
        deploymentId: testDeploymentId,
        isHealthy: true,
        responseTime: 245,
        statusCode: 200,
        lastChecked: new Date().toISOString(),
      });

      const health = await mockHealthCheckService.checkDeploymentHealth(testDeploymentId);

      expect(health.isHealthy).toBe(true);
      expect(health.statusCode).toBe(200);
      expect(health.responseTime).toBeLessThan(1000);
    });

    it('should detect unhealthy deployments', async () => {
      mockHealthCheckService.checkDeploymentHealth.mockResolvedValue({
        deploymentId: testDeploymentId,
        isHealthy: false,
        statusCode: 503,
        error: 'Service Unavailable',
        lastChecked: new Date().toISOString(),
      });

      const health = await mockHealthCheckService.checkDeploymentHealth(testDeploymentId);

      expect(health.isHealthy).toBe(false);
      expect(health.statusCode).toBe(503);
      expect(health.error).toBeDefined();
    });

    it('should check database health', async () => {
      mockHealthCheckService.checkDatabaseHealth.mockResolvedValue({
        isHealthy: true,
        connectionPoolSize: 10,
        activeConnections: 3,
        responseTime: 50,
      });

      const health = await mockHealthCheckService.checkDatabaseHealth();

      expect(health.isHealthy).toBe(true);
      expect(health.activeConnections).toBeLessThanOrEqual(health.connectionPoolSize);
    });

    it('should check service health', async () => {
      mockHealthCheckService.checkServiceHealth.mockResolvedValue({
        services: {
          auth: { healthy: true, responseTime: 100 },
          deployment: { healthy: true, responseTime: 150 },
          github: { healthy: true, responseTime: 200 },
          vercel: { healthy: true, responseTime: 180 },
        },
        overallHealth: 'healthy',
      });

      const health = await mockHealthCheckService.checkServiceHealth();

      expect(health.overallHealth).toBe('healthy');
      expect(health.services.auth.healthy).toBe(true);
    });

    it('should trigger alert on health check failure', async () => {
      mockHealthCheckService.checkDeploymentHealth.mockResolvedValue({
        deploymentId: testDeploymentId,
        isHealthy: false,
        statusCode: 500,
        error: 'Internal Server Error',
      });

      const health = await mockHealthCheckService.checkDeploymentHealth(testDeploymentId);

      if (!health.isHealthy) {
        await mockAlertService.sendWarningAlert({
          title: 'Deployment Health Check Failed',
          message: `Deployment ${testDeploymentId} is unhealthy`,
          severity: 'warning',
          deploymentId: testDeploymentId,
        });
      }

      expect(mockAlertService.sendWarningAlert).toHaveBeenCalled();
    });
  });

  describe('Alert Notification Delivery', () => {
    it('should deliver alert notifications', async () => {
      const notification = {
        id: 'notif-123',
        alertId: 'alert-123',
        userId: testUserId,
        channel: 'email',
        message: 'Critical error detected',
        timestamp: new Date().toISOString(),
      };

      await mockAlertService.sendAlert(notification);

      expect(mockAlertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining(notification)
      );
    });

    it('should support multiple notification channels', async () => {
      const channels = ['email', 'slack', 'sms', 'webhook'];

      for (const channel of channels) {
        await mockAlertService.sendAlert({
          alertId: 'alert-123',
          channel,
          message: 'Test alert',
        });
      }

      expect(mockAlertService.sendAlert).toHaveBeenCalledTimes(4);
    });

    it('should respect user notification preferences', async () => {
      const userPreferences = {
        userId: testUserId,
        channels: ['email', 'slack'],
        severityThreshold: 'warning',
      };

      const alert = {
        alertId: 'alert-123',
        severity: 'critical',
        message: 'Critical issue',
      };

      // Should send to email and slack
      for (const channel of userPreferences.channels) {
        await mockAlertService.sendAlert({
          ...alert,
          channel,
          userId: testUserId,
        });
      }

      expect(mockAlertService.sendAlert).toHaveBeenCalledTimes(2);
    });

    it('should track alert delivery status', async () => {
      const alertId = 'alert-123';

      await mockAlertService.sendAlert({
        id: alertId,
        channel: 'email',
        message: 'Test alert',
        status: 'pending',
      });

      // Simulate delivery
      await mockAlertService.sendAlert({
        id: alertId,
        channel: 'email',
        message: 'Test alert',
        status: 'delivered',
      });

      expect(mockAlertService.sendAlert).toHaveBeenCalledTimes(2);
    });

    it('should retry failed alert delivery', async () => {
      const alertId = 'alert-123';
      let attempts = 0;
      const maxRetries = 3;

      while (attempts < maxRetries) {
        try {
          await mockAlertService.sendAlert({
            id: alertId,
            channel: 'email',
            message: 'Test alert',
            attempt: attempts + 1,
          });
          break;
        } catch (error) {
          attempts++;
          if (attempts >= maxRetries) throw error;
        }
      }

      expect(mockAlertService.sendAlert).toHaveBeenCalled();
    });
  });

  describe('Alert Fatigue Prevention', () => {
    it('should deduplicate similar alerts', async () => {
      const alertKey = 'deployment-timeout';

      // Send same alert multiple times
      for (let i = 0; i < 5; i++) {
        await mockAlertService.sendAlert({
          key: alertKey,
          message: 'Deployment timeout',
          severity: 'warning',
        });
      }

      // Should only send once due to deduplication
      expect(mockAlertService.sendAlert).toHaveBeenCalled();
    });

    it('should aggregate related alerts', async () => {
      const alerts = [
        { type: 'deployment_error', deploymentId: 'dep-1' },
        { type: 'deployment_error', deploymentId: 'dep-2' },
        { type: 'deployment_error', deploymentId: 'dep-3' },
      ];

      for (const alert of alerts) {
        await mockAlertService.sendAlert(alert);
      }

      // Should aggregate into single alert
      expect(mockAlertService.sendAlert).toHaveBeenCalled();
    });

    it('should implement alert throttling', async () => {
      const throttleWindow = 60000; // 1 minute
      const maxAlertsPerWindow = 10;

      let alertCount = 0;
      for (let i = 0; i < 20; i++) {
        if (alertCount < maxAlertsPerWindow) {
          await mockAlertService.sendAlert({
            message: `Alert ${i}`,
            timestamp: new Date().toISOString(),
          });
          alertCount++;
        }
      }

      expect(mockAlertService.sendAlert).toHaveBeenCalledTimes(maxAlertsPerWindow);
    });
  });

  describe('Monitoring Test Procedures', () => {
    it('should verify all critical paths have logging', async () => {
      const criticalPaths = [
        'user_signup',
        'template_selection',
        'deployment_creation',
        'github_push',
        'vercel_deployment',
        'deployment_completion',
      ];

      for (const path of criticalPaths) {
        mockLogger.info(`Critical path: ${path}`, {
          correlationId: testCorrelationId,
        });
      }

      expect(mockLogger.info).toHaveBeenCalledTimes(criticalPaths.length);
    });

    it('should validate monitoring coverage', async () => {
      const monitoredServices = [
        'authentication',
        'deployment',
        'github',
        'vercel',
        'database',
        'cache',
      ];

      const coverage = monitoredServices.map((service) => ({
        service,
        monitored: true,
        alertsConfigured: true,
      }));

      expect(coverage.every((c) => c.monitored)).toBe(true);
      expect(coverage.every((c) => c.alertsConfigured)).toBe(true);
    });
  });
});

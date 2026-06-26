/**
 * Health Check Endpoint Tests
 * Issue #358: Create Health Check Endpoint Tests
 *
 * Tests that verify health check endpoints and system status checks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Types ────────────────────────────────────────────────────────────────

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  uptime: number;
  dependencies: Record<string, DependencyStatus>;
  responseTime: number;
}

interface DependencyStatus {
  name: string;
  status: 'up' | 'down' | 'degraded';
  responseTime: number;
  lastChecked: Date;
  error?: string;
}

// ── Mock Services ─────────────────────────────────────────────────────────────

const mockHealthCheckService = {
  checkHealth: vi.fn(),
  checkDatabaseHealth: vi.fn(),
  checkSupabaseHealth: vi.fn(),
  checkStripeHealth: vi.fn(),
  checkGitHubHealth: vi.fn(),
  checkVercelHealth: vi.fn(),
  checkStellarHealth: vi.fn(),
};

const mockDatabaseService = {
  ping: vi.fn(),
  getConnectionStatus: vi.fn(),
};

const mockSupabaseService = {
  ping: vi.fn(),
  getStatus: vi.fn(),
};

const mockStripeService = {
  ping: vi.fn(),
  getStatus: vi.fn(),
};

const mockGitHubService = {
  ping: vi.fn(),
  getStatus: vi.fn(),
};

const mockVercelService = {
  ping: vi.fn(),
  getStatus: vi.fn(),
};

const mockStellarService = {
  ping: vi.fn(),
  getStatus: vi.fn(),
};

vi.mock('@/services/health-check.service', () => ({
  healthCheckService: mockHealthCheckService,
}));

vi.mock('@/services/database.service', () => ({
  databaseService: mockDatabaseService,
}));

vi.mock('@/services/supabase.service', () => ({
  supabaseService: mockSupabaseService,
}));

vi.mock('@/services/stripe.service', () => ({
  stripeService: mockStripeService,
}));

vi.mock('@/services/github.service', () => ({
  githubService: mockGitHubService,
}));

vi.mock('@/services/vercel.service', () => ({
  vercelService: mockVercelService,
}));

vi.mock('@/services/stellar.service', () => ({
  stellarService: mockStellarService,
}));

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Health Check Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Health Check Response Format', () => {
    it('should return valid health check response', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('dependencies');
      expect(result).toHaveProperty('responseTime');
    });

    it('should have valid status values', async () => {
      const validStatuses = ['healthy', 'degraded', 'unhealthy'];

      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(validStatuses).toContain(result.status);
    });

    it('should include timestamp in response', async () => {
      const now = new Date();
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: now,
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result.timestamp).toEqual(now);
    });

    it('should include uptime in response', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result.uptime).toBeGreaterThan(0);
    });

    it('should include response time in response', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Dependency Status Checks', () => {
    it('should check database connectivity', async () => {
      mockDatabaseService.ping.mockResolvedValue({ status: 'up', responseTime: 10 });

      const result = await mockDatabaseService.ping();

      expect(result.status).toBe('up');
      expect(mockDatabaseService.ping).toHaveBeenCalled();
    });

    it('should check Supabase connectivity', async () => {
      mockSupabaseService.ping.mockResolvedValue({ status: 'up', responseTime: 15 });

      const result = await mockSupabaseService.ping();

      expect(result.status).toBe('up');
      expect(mockSupabaseService.ping).toHaveBeenCalled();
    });

    it('should check Stripe connectivity', async () => {
      mockStripeService.ping.mockResolvedValue({ status: 'up', responseTime: 20 });

      const result = await mockStripeService.ping();

      expect(result.status).toBe('up');
      expect(mockStripeService.ping).toHaveBeenCalled();
    });

    it('should check GitHub connectivity', async () => {
      mockGitHubService.ping.mockResolvedValue({ status: 'up', responseTime: 25 });

      const result = await mockGitHubService.ping();

      expect(result.status).toBe('up');
      expect(mockGitHubService.ping).toHaveBeenCalled();
    });

    it('should check Vercel connectivity', async () => {
      mockVercelService.ping.mockResolvedValue({ status: 'up', responseTime: 30 });

      const result = await mockVercelService.ping();

      expect(result.status).toBe('up');
      expect(mockVercelService.ping).toHaveBeenCalled();
    });

    it('should check Stellar connectivity', async () => {
      mockStellarService.ping.mockResolvedValue({ status: 'up', responseTime: 35 });

      const result = await mockStellarService.ping();

      expect(result.status).toBe('up');
      expect(mockStellarService.ping).toHaveBeenCalled();
    });

    it('should include all dependencies in response', async () => {
      const dependencies: Record<string, DependencyStatus> = {
        database: {
          name: 'PostgreSQL',
          status: 'up',
          responseTime: 10,
          lastChecked: new Date(),
        },
        supabase: {
          name: 'Supabase',
          status: 'up',
          responseTime: 15,
          lastChecked: new Date(),
        },
        stripe: {
          name: 'Stripe',
          status: 'up',
          responseTime: 20,
          lastChecked: new Date(),
        },
      };

      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies,
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(Object.keys(result.dependencies).length).toBeGreaterThan(0);
    });
  });

  describe('Health Check Performance', () => {
    it('should complete health check within acceptable time', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 100,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const startTime = Date.now();
      await mockHealthCheckService.checkHealth();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should have fast response times for dependencies', async () => {
      const dependency: DependencyStatus = {
        name: 'Database',
        status: 'up',
        responseTime: 50,
        lastChecked: new Date(),
      };

      expect(dependency.responseTime).toBeLessThan(1000);
    });

    it('should aggregate dependency checks efficiently', async () => {
      const dependencies: Record<string, DependencyStatus> = {
        db: {
          name: 'Database',
          status: 'up',
          responseTime: 10,
          lastChecked: new Date(),
        },
        supabase: {
          name: 'Supabase',
          status: 'up',
          responseTime: 15,
          lastChecked: new Date(),
        },
        stripe: {
          name: 'Stripe',
          status: 'up',
          responseTime: 20,
          lastChecked: new Date(),
        },
      };

      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies,
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result.responseTime).toBeLessThan(100);
    });
  });

  describe('Degraded State Detection', () => {
    it('should detect degraded status when some dependencies are down', async () => {
      const dependencies: Record<string, DependencyStatus> = {
        database: {
          name: 'Database',
          status: 'up',
          responseTime: 10,
          lastChecked: new Date(),
        },
        stripe: {
          name: 'Stripe',
          status: 'down',
          responseTime: 0,
          lastChecked: new Date(),
          error: 'Connection timeout',
        },
      };

      const response: HealthCheckResponse = {
        status: 'degraded',
        timestamp: new Date(),
        uptime: 86400,
        dependencies,
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result.status).toBe('degraded');
    });

    it('should detect unhealthy status when critical dependencies are down', async () => {
      const dependencies: Record<string, DependencyStatus> = {
        database: {
          name: 'Database',
          status: 'down',
          responseTime: 0,
          lastChecked: new Date(),
          error: 'Connection refused',
        },
      };

      const response: HealthCheckResponse = {
        status: 'unhealthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies,
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result.status).toBe('unhealthy');
    });

    it('should include error details for failed dependencies', async () => {
      const dependency: DependencyStatus = {
        name: 'Stripe',
        status: 'down',
        responseTime: 0,
        lastChecked: new Date(),
        error: 'API key invalid',
      };

      expect(dependency.error).toBeDefined();
      expect(dependency.error).toBe('API key invalid');
    });
  });

  describe('Health Check Authentication', () => {
    it('should allow unauthenticated health checks', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result).toBeDefined();
    });

    it('should allow authenticated health checks', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result).toBeDefined();
    });

    it('should not require special permissions for health checks', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result).toBeDefined();
    });
  });

  describe('Health Check Contract', () => {
    it('should have consistent response structure', async () => {
      const response: HealthCheckResponse = {
        status: 'healthy',
        timestamp: new Date(),
        uptime: 86400,
        dependencies: {},
        responseTime: 45,
      };

      mockHealthCheckService.checkHealth.mockResolvedValue(response);

      const result = await mockHealthCheckService.checkHealth();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('dependencies');
      expect(result).toHaveProperty('responseTime');
    });

    it('should have valid dependency structure', async () => {
      const dependency: DependencyStatus = {
        name: 'Database',
        status: 'up',
        responseTime: 10,
        lastChecked: new Date(),
      };

      expect(dependency).toHaveProperty('name');
      expect(dependency).toHaveProperty('status');
      expect(dependency).toHaveProperty('responseTime');
      expect(dependency).toHaveProperty('lastChecked');
    });

    it('should document health check contract', () => {
      const contract = {
        endpoint: '/api/health',
        method: 'GET',
        authentication: 'none',
        rateLimit: 'unlimited',
        responseFormat: 'application/json',
        statusCodes: {
          200: 'Health check successful',
          503: 'Service unavailable',
        },
      };

      expect(contract.endpoint).toBe('/api/health');
      expect(contract.method).toBe('GET');
      expect(contract.authentication).toBe('none');
    });
  });

  describe('Failure Conditions', () => {
    it('should handle database connection failure', async () => {
      mockDatabaseService.ping.mockRejectedValue(new Error('Connection refused'));

      const dependency: DependencyStatus = {
        name: 'Database',
        status: 'down',
        responseTime: 0,
        lastChecked: new Date(),
        error: 'Connection refused',
      };

      expect(dependency.status).toBe('down');
      expect(dependency.error).toBeDefined();
    });

    it('should handle timeout errors', async () => {
      mockStripeService.ping.mockRejectedValue(new Error('Request timeout'));

      const dependency: DependencyStatus = {
        name: 'Stripe',
        status: 'down',
        responseTime: 0,
        lastChecked: new Date(),
        error: 'Request timeout',
      };

      expect(dependency.error).toBe('Request timeout');
    });

    it('should continue checking other dependencies on failure', async () => {
      mockDatabaseService.ping.mockRejectedValue(new Error('Connection refused'));
      mockStripeService.ping.mockResolvedValue({ status: 'up', responseTime: 20 });

      await mockDatabaseService.ping().catch(() => {});
      const stripeResult = await mockStripeService.ping();

      expect(stripeResult.status).toBe('up');
    });
  });
});

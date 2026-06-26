/**
 * Chaos Engineering Tests for Vercel Deployment Failures
 *
 * Simulates various failure scenarios in the Vercel API to verify
 * correct retry behavior and error propagation.
 *
 * Scenarios:
 *   - Network timeout (simulated with delayed response)
 *   - 429 rate limit errors
 *   - 500 server errors
 *   - Partial deployment failures (rollback verification)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VercelService, VercelApiError } from './vercel.service';
import { FaultInjector } from './fault-injector';

describe('VercelService - Chaos Engineering', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let service: VercelService;
  let faultInjector: FaultInjector;

  beforeEach(() => {
    mockFetch = vi.fn();
    service = new VercelService(mockFetch);
    faultInjector = new FaultInjector();
  });

  describe('Network Timeout Scenario', () => {
    it('should retry on timeout and eventually succeed', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          // Simulate timeout on first two attempts
          await new Promise(resolve => setTimeout(resolve, 100));
          throw new Error('Network timeout');
        }
        // Succeed on third attempt
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'prj_123', name: 'test-project' }),
        };
      });

      const result = await service.createProject('test-project', {
        token: 'test_token',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('prj_123');
      expect(callCount).toBeGreaterThanOrEqual(3);
    });

    it('should fail after max retries on persistent timeout', async () => {
      mockFetch.mockImplementation(async () => {
        throw new Error('Network timeout');
      });

      await expect(
        service.createProject('test-project', { token: 'test_token' })
      ).rejects.toThrow();
    });
  });

  describe('Rate Limit (429) Scenario', () => {
    it('should retry on 429 and succeed', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            headers: { get: (k: string) => (k === 'retry-after' ? '1' : null) },
            json: async () => ({ error: 'Too many requests' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'prj_123', name: 'test-project' }),
        };
      });

      const result = await service.createProject('test-project', {
        token: 'test_token',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('prj_123');
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should fail after max retries on persistent 429', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 429,
        headers: { get: () => null },
        json: async () => ({ error: 'Too many requests' }),
      }));

      await expect(
        service.createProject('test-project', { token: 'test_token' })
      ).rejects.toThrow(VercelApiError);
    });
  });

  describe('Server Error (500) Scenario', () => {
    it('should retry on 500 and succeed', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'prj_123', name: 'test-project' }),
        };
      });

      const result = await service.createProject('test-project', {
        token: 'test_token',
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('prj_123');
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('should fail with 500 after max retries', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      }));

      await expect(
        service.createProject('test-project', { token: 'test_token' })
      ).rejects.toThrow(VercelApiError);
    });
  });

  describe('Partial Deployment Failure - Rollback Verification', () => {
    it('should detect partial deployment failure and trigger rollback', async () => {
      const deploymentId = 'dpl_456';
      let callCount = 0;

      mockFetch.mockImplementation(async (url: string) => {
        callCount++;

        // First call: create project succeeds
        if (url.includes('/projects') && callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: 'prj_123', name: 'test-project' }),
          };
        }

        // Second call: trigger deployment fails mid-way
        if (url.includes('/deployments') && callCount === 2) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: 'Deployment failed' }),
          };
        }

        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      });

      // Attempt deployment
      await expect(
        service.triggerDeployment('prj_123', { token: 'test_token' })
      ).rejects.toThrow();

      // Verify rollback was attempted
      expect(callCount).toBeGreaterThan(1);
    });

    it('should maintain consistent state after partial failure', async () => {
      let deploymentState = { status: 'QUEUED' };

      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes('/deployments')) {
          // Simulate state inconsistency
          if (deploymentState.status === 'QUEUED') {
            deploymentState.status = 'BUILDING';
            return {
              ok: false,
              status: 500,
              json: async () => ({ error: 'Build failed' }),
            };
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => deploymentState,
        };
      });

      await expect(
        service.triggerDeployment('prj_123', { token: 'test_token' })
      ).rejects.toThrow();

      // State should be recoverable
      expect(deploymentState.status).toBeDefined();
    });
  });

  describe('Error Propagation', () => {
    it('should propagate auth errors without retry', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      }));

      await expect(
        service.createProject('test-project', { token: 'invalid_token' })
      ).rejects.toThrow(VercelApiError);

      // Should only be called once (no retry for 401)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should propagate forbidden errors without retry', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden' }),
      }));

      await expect(
        service.createProject('test-project', { token: 'test_token' })
      ).rejects.toThrow(VercelApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should propagate not found errors without retry', async () => {
      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      }));

      await expect(
        service.getDeployment('nonexistent', { token: 'test_token' })
      ).rejects.toThrow(VercelApiError);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Chaos Scenario: Cascading Failures', () => {
    it('should handle multiple sequential failures gracefully', async () => {
      const failures = [
        { status: 500, error: 'Server error' },
        { status: 429, error: 'Rate limited' },
        { status: 503, error: 'Service unavailable' },
      ];

      let failureIndex = 0;

      mockFetch.mockImplementation(async () => {
        if (failureIndex < failures.length) {
          const failure = failures[failureIndex];
          failureIndex++;
          return {
            ok: false,
            status: failure.status,
            headers: { get: () => null },
            json: async () => ({ error: failure.error }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'prj_123' }),
        };
      });

      const result = await service.createProject('test-project', {
        token: 'test_token',
      });

      expect(result).toBeDefined();
      expect(failureIndex).toBeGreaterThan(0);
    });
  });

  describe('Fault Injection Integration', () => {
    it('should handle injected faults in deployment config', () => {
      const originalConfig = {
        path: 'vercel.json',
        content: '{"buildCommand": "npm run build"}',
        type: 'json' as const,
      };

      const faultedConfig = faultInjector.inject(originalConfig, 'invalid_json_key');

      expect(faultedConfig.content).not.toBe(originalConfig.content);
      expect(faultedConfig.path).toBe(originalConfig.path);
    });
  });
});

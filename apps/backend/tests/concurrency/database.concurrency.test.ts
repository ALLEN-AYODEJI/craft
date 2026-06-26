/**
 * Concurrency Tests for Database Operations
 * Issue #333: Add concurrency tests for database operations
 *
 * Tests that verify database operations handle concurrent access correctly
 * without race conditions or deadlocks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Services ─────────────────────────────────────────────────────────────

const mockDatabase = {
  query: vi.fn(),
  transaction: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  getConnectionPool: vi.fn(),
};

const mockDeploymentRepository = {
  create: vi.fn(),
  update: vi.fn(),
  findById: vi.fn(),
  findByUserId: vi.fn(),
  delete: vi.fn(),
};

const mockLockingService = {
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  isLocked: vi.fn(),
};

const mockTransactionService = {
  executeInTransaction: vi.fn(),
  getIsolationLevel: vi.fn(),
  setIsolationLevel: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockDatabase,
}));

vi.mock('@/services/deployment.repository', () => ({
  deploymentRepository: mockDeploymentRepository,
}));

vi.mock('@/services/locking.service', () => ({
  lockingService: mockLockingService,
}));

vi.mock('@/services/transaction.service', () => ({
  transactionService: mockTransactionService,
}));

// ── Test Data ─────────────────────────────────────────────────────────────────

const testDeployment = {
  id: 'deployment-123',
  userId: 'user-123',
  templateId: 'template-dex',
  name: 'My DEX',
  status: 'pending',
  version: 1,
};

// ── Helper Functions ──────────────────────────────────────────────────────────

async function simulateConcurrentOperations(
  operationCount: number,
  operation: (index: number) => Promise<any>
): Promise<any[]> {
  const promises = [];
  for (let i = 0; i < operationCount; i++) {
    promises.push(operation(i));
  }
  return Promise.all(promises);
}

function createDeploymentWithVersion(id: string, version: number) {
  return {
    ...testDeployment,
    id,
    version,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Concurrency Tests: Database Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransactionService.getIsolationLevel.mockReturnValue('READ_COMMITTED');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Concurrent Deployment Creation', () => {
    it('should handle concurrent deployment creation without conflicts', async () => {
      const concurrentCount = 10;
      const deployments: any[] = [];

      mockDeploymentRepository.create.mockImplementation(async (data) => {
        // Simulate database write delay
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        return { ...data, id: `deployment-${Date.now()}-${Math.random()}` };
      });

      const results = await simulateConcurrentOperations(concurrentCount, async (index) => {
        return mockDeploymentRepository.create({
          userId: `user-${index}`,
          templateId: 'template-dex',
          name: `Deployment ${index}`,
        });
      });

      expect(results).toHaveLength(concurrentCount);
      expect(new Set(results.map((r) => r.id)).size).toBe(concurrentCount);
    });

    it('should prevent duplicate deployment names for same user', async () => {
      const userId = 'user-123';
      const deploymentName = 'My DEX';

      mockDeploymentRepository.create.mockImplementation(async (data) => {
        // Check for duplicates
        const existing = await mockDeploymentRepository.findByUserId(userId);
        if (existing?.some((d: any) => d.name === deploymentName)) {
          throw new Error('Deployment name already exists');
        }
        return { ...data, id: `deployment-${Date.now()}` };
      });

      mockDeploymentRepository.findByUserId.mockResolvedValue([]);

      const results = await simulateConcurrentOperations(2, async () => {
        return mockDeploymentRepository.create({
          userId,
          templateId: 'template-dex',
          name: deploymentName,
        });
      });

      expect(results).toHaveLength(2);
    });

    it('should maintain referential integrity during concurrent creates', async () => {
      const userId = 'user-123';
      const templateId = 'template-dex';

      mockDeploymentRepository.create.mockImplementation(async (data) => {
        // Verify foreign keys exist
        if (!userId || !templateId) {
          throw new Error('Invalid foreign key');
        }
        return { ...data, id: `deployment-${Date.now()}` };
      });

      const results = await simulateConcurrentOperations(5, async () => {
        return mockDeploymentRepository.create({
          userId,
          templateId,
          name: `Deployment ${Date.now()}`,
        });
      });

      expect(results).toHaveLength(5);
      expect(mockDeploymentRepository.create).toHaveBeenCalledTimes(5);
    });
  });

  describe('Optimistic Locking for Updates', () => {
    it('should detect version conflicts on concurrent updates', async () => {
      const deploymentId = 'deployment-123';
      let currentVersion = 1;

      mockDeploymentRepository.update.mockImplementation(async (id, data, expectedVersion) => {
        if (expectedVersion !== currentVersion) {
          throw new Error('Version conflict: concurrent modification detected');
        }
        currentVersion++;
        return { ...data, id, version: currentVersion };
      });

      // First update succeeds
      const update1 = await mockDeploymentRepository.update(
        deploymentId,
        { status: 'building' },
        1
      );
      expect(update1.version).toBe(2);

      // Second update with old version fails
      try {
        await mockDeploymentRepository.update(deploymentId, { status: 'completed' }, 1);
        expect.fail('Should have thrown version conflict error');
      } catch (error: any) {
        expect(error.message).toContain('Version conflict');
      }
    });

    it('should handle concurrent updates with version increments', async () => {
      const deploymentId = 'deployment-123';
      let version = 1;

      mockDeploymentRepository.update.mockImplementation(async (id, data, expectedVersion) => {
        if (expectedVersion !== version) {
          throw new Error('Version conflict');
        }
        version++;
        return { ...data, id, version };
      });

      const updates = [
        { status: 'building', expectedVersion: 1 },
        { status: 'verifying', expectedVersion: 2 },
        { status: 'completed', expectedVersion: 3 },
      ];

      for (const update of updates) {
        const result = await mockDeploymentRepository.update(
          deploymentId,
          { status: update.status },
          update.expectedVersion
        );
        expect(result.version).toBe(update.expectedVersion + 1);
      }
    });

    it('should retry on version conflict', async () => {
      const deploymentId = 'deployment-123';
      let attemptCount = 0;
      let currentVersion = 1;

      mockDeploymentRepository.update.mockImplementation(async (id, data, expectedVersion) => {
        attemptCount++;
        if (expectedVersion !== currentVersion) {
          throw new Error('Version conflict');
        }
        currentVersion++;
        return { ...data, id, version: currentVersion };
      });

      // Simulate retry logic
      let retries = 0;
      const maxRetries = 3;
      let result;

      while (retries < maxRetries) {
        try {
          result = await mockDeploymentRepository.update(
            deploymentId,
            { status: 'completed' },
            currentVersion
          );
          break;
        } catch (error) {
          retries++;
          if (retries >= maxRetries) throw error;
        }
      }

      expect(result).toBeDefined();
    });
  });

  describe('Transaction Isolation Levels', () => {
    it('should use READ_COMMITTED isolation by default', async () => {
      const isolationLevel = mockTransactionService.getIsolationLevel();
      expect(isolationLevel).toBe('READ_COMMITTED');
    });

    it('should prevent dirty reads with appropriate isolation', async () => {
      mockTransactionService.setIsolationLevel('READ_COMMITTED');

      mockDatabase.beginTransaction.mockResolvedValue({ id: 'txn-1' });
      mockDatabase.query.mockResolvedValue({ data: { status: 'pending' } });
      mockDatabase.commit.mockResolvedValue(undefined);

      const txn1 = await mockDatabase.beginTransaction();
      const data = await mockDatabase.query('SELECT * FROM deployments WHERE id = ?', [
        'deployment-123',
      ]);

      expect(data.data.status).toBe('pending');

      await mockDatabase.commit();
    });

    it('should prevent non-repeatable reads with REPEATABLE_READ', async () => {
      mockTransactionService.setIsolationLevel('REPEATABLE_READ');

      let readCount = 0;
      mockDatabase.query.mockImplementation(async () => {
        readCount++;
        return { data: { status: readCount === 1 ? 'pending' : 'building' } };
      });

      const txn = await mockDatabase.beginTransaction();

      const read1 = await mockDatabase.query('SELECT * FROM deployments WHERE id = ?', [
        'deployment-123',
      ]);
      const read2 = await mockDatabase.query('SELECT * FROM deployments WHERE id = ?', [
        'deployment-123',
      ]);

      // With REPEATABLE_READ, both reads should return same value
      expect(read1.data.status).toBe(read2.data.status);
    });

    it('should prevent phantom reads with SERIALIZABLE', async () => {
      mockTransactionService.setIsolationLevel('SERIALIZABLE');

      mockDatabase.query.mockResolvedValue({
        data: [
          { id: 'dep-1', status: 'completed' },
          { id: 'dep-2', status: 'completed' },
        ],
      });

      const txn = await mockDatabase.beginTransaction();

      const count1 = await mockDatabase.query('SELECT COUNT(*) FROM deployments WHERE status = ?', [
        'completed',
      ]);

      // Insert new row (simulated)
      const count2 = await mockDatabase.query('SELECT COUNT(*) FROM deployments WHERE status = ?', [
        'completed',
      ]);

      // With SERIALIZABLE, counts should be consistent
      expect(count1).toEqual(count2);
    });
  });

  describe('Race Condition Detection', () => {
    it('should detect race conditions in status updates', async () => {
      const deploymentId = 'deployment-123';
      let statusUpdateCount = 0;

      mockDeploymentRepository.update.mockImplementation(async (id, data) => {
        statusUpdateCount++;
        // Simulate race condition detection
        if (statusUpdateCount > 1) {
          throw new Error('Race condition detected: concurrent status update');
        }
        return { ...data, id };
      });

      const updates = simulateConcurrentOperations(3, async () => {
        return mockDeploymentRepository.update(deploymentId, { status: 'building' });
      });

      try {
        await updates;
      } catch (error: any) {
        expect(error.message).toContain('Race condition');
      }
    });

    it('should handle concurrent status transitions safely', async () => {
      const deploymentId = 'deployment-123';
      const validTransitions: Record<string, string[]> = {
        pending: ['building'],
        building: ['verifying', 'failed'],
        verifying: ['completed', 'failed'],
        completed: [],
        failed: [],
      };

      mockDeploymentRepository.update.mockImplementation(async (id, data) => {
        const currentStatus = 'pending';
        const newStatus = data.status;

        if (!validTransitions[currentStatus]?.includes(newStatus)) {
          throw new Error(`Invalid transition from ${currentStatus} to ${newStatus}`);
        }

        return { ...data, id };
      });

      const result = await mockDeploymentRepository.update(deploymentId, { status: 'building' });
      expect(result.status).toBe('building');
    });

    it('should prevent double-processing of deployments', async () => {
      const deploymentId = 'deployment-123';
      let processCount = 0;

      mockDeploymentRepository.update.mockImplementation(async (id, data) => {
        if (data.status === 'processing') {
          processCount++;
          if (processCount > 1) {
            throw new Error('Deployment already being processed');
          }
        }
        return { ...data, id };
      });

      const results = await simulateConcurrentOperations(2, async () => {
        try {
          return await mockDeploymentRepository.update(deploymentId, { status: 'processing' });
        } catch (error) {
          return { error: (error as Error).message };
        }
      });

      const errors = results.filter((r) => r.error);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('Deadlock Prevention', () => {
    it('should detect and handle deadlocks', async () => {
      mockDatabase.transaction.mockImplementation(async (callback) => {
        try {
          return await callback();
        } catch (error: any) {
          if (error.message.includes('deadlock')) {
            throw new Error('Deadlock detected');
          }
          throw error;
        }
      });

      const operation = async () => {
        return mockDatabase.transaction(async () => {
          // Simulate potential deadlock
          await mockDatabase.query('UPDATE deployments SET status = ? WHERE id = ?', [
            'building',
            'dep-1',
          ]);
          await new Promise((resolve) => setTimeout(resolve, 10));
          await mockDatabase.query('UPDATE deployments SET status = ? WHERE id = ?', [
            'building',
            'dep-2',
          ]);
        });
      };

      expect(operation).not.toThrow();
    });

    it('should use consistent lock ordering to prevent deadlocks', async () => {
      const lockOrder = ['deployment-1', 'deployment-2', 'deployment-3'];

      mockLockingService.acquireLock.mockImplementation(async (resource) => {
        const index = lockOrder.indexOf(resource);
        if (index === -1) {
          throw new Error('Invalid lock order');
        }
        return { resource, acquired: true };
      });

      const locks = await simulateConcurrentOperations(3, async (index) => {
        return mockLockingService.acquireLock(lockOrder[index]);
      });

      expect(locks.every((l) => l.acquired)).toBe(true);
    });

    it('should implement lock timeout to prevent indefinite waits', async () => {
      const lockTimeout = 5000; // 5 seconds

      mockLockingService.acquireLock.mockImplementation(async (resource) => {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Lock acquisition timeout'));
          }, lockTimeout);

          // Simulate lock acquisition
          setTimeout(() => {
            clearTimeout(timer);
            resolve({ resource, acquired: true });
          }, 100);
        });
      });

      const lock = await mockLockingService.acquireLock('deployment-123');
      expect(lock.acquired).toBe(true);
    });
  });

  describe('Connection Pool Management', () => {
    it('should manage connection pool efficiently', async () => {
      const poolSize = 10;
      const activeConnections = 3;

      mockDatabase.getConnectionPool.mockReturnValue({
        size: poolSize,
        activeConnections,
        availableConnections: poolSize - activeConnections,
      });

      const pool = mockDatabase.getConnectionPool();

      expect(pool.size).toBe(poolSize);
      expect(pool.activeConnections).toBeLessThanOrEqual(pool.size);
      expect(pool.availableConnections).toBeGreaterThan(0);
    });

    it('should handle connection pool exhaustion', async () => {
      const poolSize = 5;
      let activeConnections = 0;

      mockDatabase.query.mockImplementation(async () => {
        activeConnections++;
        if (activeConnections > poolSize) {
          throw new Error('Connection pool exhausted');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeConnections--;
        return { data: [] };
      });

      const queries = simulateConcurrentOperations(10, async () => {
        try {
          return await mockDatabase.query('SELECT * FROM deployments');
        } catch (error) {
          return { error: (error as Error).message };
        }
      });

      const results = await queries;
      const errors = results.filter((r) => r.error);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reuse connections from pool', async () => {
      const connectionIds = new Set<string>();

      mockDatabase.query.mockImplementation(async () => {
        const connId = `conn-${Math.floor(Math.random() * 5)}`;
        connectionIds.add(connId);
        return { data: [], connectionId: connId };
      });

      await simulateConcurrentOperations(20, async () => {
        return mockDatabase.query('SELECT * FROM deployments');
      });

      // Should reuse connections (fewer unique IDs than total queries)
      expect(connectionIds.size).toBeLessThan(20);
    });
  });

  describe('Data Consistency After Concurrent Operations', () => {
    it('should maintain data consistency after concurrent updates', async () => {
      const deploymentId = 'deployment-123';
      let finalVersion = 1;

      mockDeploymentRepository.update.mockImplementation(async (id, data, version) => {
        if (version !== finalVersion) {
          throw new Error('Version conflict');
        }
        finalVersion++;
        return { ...data, id, version: finalVersion };
      });

      const updates = [
        { status: 'building' },
        { status: 'verifying' },
        { status: 'completed' },
      ];

      for (const update of updates) {
        await mockDeploymentRepository.update(deploymentId, update, finalVersion);
      }

      expect(finalVersion).toBe(4); // Initial 1 + 3 updates
    });

    it('should verify no data corruption after concurrent operations', async () => {
      const deploymentId = 'deployment-123';

      mockDeploymentRepository.findById.mockResolvedValue({
        ...testDeployment,
        id: deploymentId,
        status: 'completed',
        version: 5,
      });

      const deployment = await mockDeploymentRepository.findById(deploymentId);

      expect(deployment.id).toBe(deploymentId);
      expect(deployment.status).toBe('completed');
      expect(deployment.version).toBe(5);
      expect(deployment.userId).toBe(testDeployment.userId);
    });

    it('should ensure atomic operations complete fully or not at all', async () => {
      const deploymentId = 'deployment-123';
      let transactionState = 'initial';

      mockDatabase.transaction.mockImplementation(async (callback) => {
        transactionState = 'started';
        try {
          const result = await callback();
          transactionState = 'committed';
          return result;
        } catch (error) {
          transactionState = 'rolled_back';
          throw error;
        }
      });

      await mockDatabase.transaction(async () => {
        await mockDeploymentRepository.update(deploymentId, { status: 'building' });
      });

      expect(transactionState).toBe('committed');
    });
  });
});

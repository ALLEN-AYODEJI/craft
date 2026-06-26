import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Deployment Queue Management Tests
 * 
 * Verifies deployment queue management handles concurrent requests
 * and rate limits correctly.
 */

interface QueueJob {
  id: string;
  deploymentId: string;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retries: number;
  maxRetries: number;
  error?: string;
}

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalProcessed: number;
}

interface RateLimitConfig {
  requestsPerMinute: number;
  burstSize: number;
}

class DeploymentQueue {
  private queue: Map<string, QueueJob> = new Map();
  private processing: Set<string> = new Set();
  private rateLimitConfig: RateLimitConfig = {
    requestsPerMinute: 60,
    burstSize: 10,
  };
  private requestTimestamps: number[] = [];
  private stats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalProcessed: 0,
  };

  enqueue(deploymentId: string, priority: number = 0): QueueJob {
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded');
    }

    const job: QueueJob = {
      id: `job-${Date.now()}-${Math.random()}`,
      deploymentId,
      priority,
      status: 'pending',
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 3,
    };

    this.queue.set(job.id, job);
    this.stats.pending++;
    this.recordRequest();

    return job;
  }

  dequeue(): QueueJob | null {
    const jobs = Array.from(this.queue.values())
      .filter((j) => j.status === 'pending')
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    if (jobs.length === 0) {
      return null;
    }

    const job = jobs[0];
    job.status = 'processing';
    job.startedAt = Date.now();
    this.processing.add(job.id);
    this.stats.pending--;
    this.stats.processing++;

    return job;
  }

  completeJob(jobId: string): void {
    const job = this.queue.get(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    job.status = 'completed';
    job.completedAt = Date.now();
    this.processing.delete(jobId);
    this.stats.processing--;
    this.stats.completed++;
    this.stats.totalProcessed++;
  }

  failJob(jobId: string, error: string): void {
    const job = this.queue.get(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    job.error = error;
    job.retries++;

    if (job.retries >= job.maxRetries) {
      job.status = 'failed';
      this.processing.delete(jobId);
      this.stats.processing--;
      this.stats.failed++;
    } else {
      job.status = 'pending';
      this.processing.delete(jobId);
      this.stats.processing--;
      this.stats.pending++;
    }
  }

  retryJob(jobId: string): void {
    const job = this.queue.get(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    if (job.retries < job.maxRetries) {
      job.status = 'pending';
      job.retries++;
      this.stats.pending++;
    }
  }

  getJob(jobId: string): QueueJob | undefined {
    return this.queue.get(jobId);
  }

  getStats(): QueueStats {
    return { ...this.stats };
  }

  getQueueSize(): number {
    return this.queue.size;
  }

  getProcessingCount(): number {
    return this.processing.size;
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    this.requestTimestamps = this.requestTimestamps.filter((t) => t > oneMinuteAgo);

    if (this.requestTimestamps.length >= this.rateLimitConfig.requestsPerMinute) {
      return false;
    }

    return true;
  }

  private recordRequest(): void {
    this.requestTimestamps.push(Date.now());
  }

  setRateLimit(config: RateLimitConfig): void {
    this.rateLimitConfig = config;
  }

  async processQueue(maxConcurrent: number = 5): Promise<number> {
    let processed = 0;
    const workers: Promise<void>[] = [];

    for (let i = 0; i < maxConcurrent; i++) {
      workers.push(
        (async () => {
          let job = this.dequeue();
          while (job) {
            try {
              await this.simulateProcessing();
              this.completeJob(job.id);
              processed++;
            } catch (error) {
              this.failJob(job.id, (error as Error).message);
            }
            job = this.dequeue();
          }
        })()
      );
    }

    await Promise.all(workers);
    return processed;
  }

  private async simulateProcessing(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, Math.random() * 100);
    });
  }

  persistQueue(): string {
    const data = {
      jobs: Array.from(this.queue.values()),
      stats: this.stats,
      timestamp: Date.now(),
    };
    return JSON.stringify(data);
  }

  restoreQueue(data: string): void {
    const parsed = JSON.parse(data);
    this.queue.clear();
    this.stats = parsed.stats;

    parsed.jobs.forEach((job: QueueJob) => {
      this.queue.set(job.id, job);
    });
  }

  clearQueue(): void {
    this.queue.clear();
    this.processing.clear();
    this.stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      totalProcessed: 0,
    };
  }
}

describe('Deployment Queue Management', () => {
  let queue: DeploymentQueue;

  beforeEach(() => {
    queue = new DeploymentQueue();
  });

  describe('Queue Operations', () => {
    it('should enqueue a job', () => {
      const job = queue.enqueue('deploy-1', 1);

      expect(job).toBeDefined();
      expect(job.status).toBe('pending');
      expect(job.deploymentId).toBe('deploy-1');
    });

    it('should dequeue a job', () => {
      queue.enqueue('deploy-1', 1);
      const job = queue.dequeue();

      expect(job).toBeDefined();
      expect(job!.status).toBe('processing');
    });

    it('should return null when queue is empty', () => {
      const job = queue.dequeue();

      expect(job).toBeNull();
    });

    it('should complete a job', () => {
      const job = queue.enqueue('deploy-1', 1);
      queue.dequeue();
      queue.completeJob(job.id);

      const stats = queue.getStats();

      expect(stats.completed).toBe(1);
      expect(stats.totalProcessed).toBe(1);
    });

    it('should fail a job', () => {
      const job = queue.enqueue('deploy-1', 1);
      queue.dequeue();
      queue.failJob(job.id, 'Deployment failed');

      const stats = queue.getStats();

      expect(stats.pending).toBe(1); // Retried
      expect(stats.processing).toBe(0);
    });
  });

  describe('Queue Ordering and Priority', () => {
    it('should process high priority jobs first', () => {
      queue.enqueue('deploy-1', 1);
      queue.enqueue('deploy-2', 5);
      queue.enqueue('deploy-3', 3);

      const job1 = queue.dequeue();
      const job2 = queue.dequeue();
      const job3 = queue.dequeue();

      expect(job1!.deploymentId).toBe('deploy-2'); // Priority 5
      expect(job2!.deploymentId).toBe('deploy-3'); // Priority 3
      expect(job3!.deploymentId).toBe('deploy-1'); // Priority 1
    });

    it('should maintain FIFO for same priority', () => {
      const job1 = queue.enqueue('deploy-1', 1);
      const job2 = queue.enqueue('deploy-2', 1);
      const job3 = queue.enqueue('deploy-3', 1);

      const dequeued1 = queue.dequeue();
      const dequeued2 = queue.dequeue();
      const dequeued3 = queue.dequeue();

      expect(dequeued1!.id).toBe(job1.id);
      expect(dequeued2!.id).toBe(job2.id);
      expect(dequeued3!.id).toBe(job3.id);
    });
  });

  describe('Rate Limit Integration', () => {
    it('should enforce rate limits', () => {
      queue.setRateLimit({ requestsPerMinute: 5, burstSize: 2 });

      for (let i = 0; i < 5; i++) {
        queue.enqueue(`deploy-${i}`, 1);
      }

      expect(() => queue.enqueue('deploy-6', 1)).toThrow('Rate limit exceeded');
    });

    it('should allow requests within rate limit', () => {
      queue.setRateLimit({ requestsPerMinute: 10, burstSize: 5 });

      for (let i = 0; i < 10; i++) {
        expect(() => queue.enqueue(`deploy-${i}`, 1)).not.toThrow();
      }
    });
  });

  describe('Queue Persistence', () => {
    it('should persist queue to JSON', () => {
      queue.enqueue('deploy-1', 1);
      queue.enqueue('deploy-2', 2);

      const persisted = queue.persistQueue();
      const parsed = JSON.parse(persisted);

      expect(parsed.jobs.length).toBe(2);
      expect(parsed.stats.pending).toBe(2);
    });

    it('should restore queue from JSON', () => {
      queue.enqueue('deploy-1', 1);
      const persisted = queue.persistQueue();

      const newQueue = new DeploymentQueue();
      newQueue.restoreQueue(persisted);

      expect(newQueue.getQueueSize()).toBe(1);
      expect(newQueue.getStats().pending).toBe(1);
    });

    it('should restore queue state across restarts', () => {
      queue.enqueue('deploy-1', 1);
      queue.enqueue('deploy-2', 2);
      const job1 = queue.dequeue();
      queue.completeJob(job1!.id);

      const persisted = queue.persistQueue();

      const newQueue = new DeploymentQueue();
      newQueue.restoreQueue(persisted);
      const stats = newQueue.getStats();

      expect(stats.completed).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });

  describe('Queue Worker Scaling', () => {
    it('should process jobs with multiple workers', async () => {
      for (let i = 0; i < 10; i++) {
        queue.enqueue(`deploy-${i}`, 1);
      }

      const processed = await queue.processQueue(3);

      expect(processed).toBe(10);
      expect(queue.getStats().completed).toBe(10);
    });

    it('should handle concurrent processing', async () => {
      for (let i = 0; i < 20; i++) {
        queue.enqueue(`deploy-${i}`, 1);
      }

      const processed = await queue.processQueue(5);

      expect(processed).toBe(20);
      expect(queue.getProcessingCount()).toBe(0);
    });

    it('should not exceed max concurrent workers', async () => {
      for (let i = 0; i < 50; i++) {
        queue.enqueue(`deploy-${i}`, 1);
      }

      const maxConcurrent = 5;
      let maxProcessing = 0;

      const originalDequeue = queue.dequeue.bind(queue);
      queue.dequeue = function () {
        const current = this.getProcessingCount();
        if (current > maxProcessing) {
          maxProcessing = current;
        }
        return originalDequeue();
      };

      await queue.processQueue(maxConcurrent);

      expect(maxProcessing).toBeLessThanOrEqual(maxConcurrent);
    });
  });

  describe('Queue Failure Handling', () => {
    it('should retry failed jobs', () => {
      const job = queue.enqueue('deploy-1', 1);
      queue.dequeue();
      queue.failJob(job.id, 'Network error');

      const stats = queue.getStats();

      expect(stats.pending).toBe(1);
      expect(job.retries).toBe(1);
    });

    it('should mark job as failed after max retries', () => {
      const job = queue.enqueue('deploy-1', 1);

      for (let i = 0; i < 3; i++) {
        queue.dequeue();
        queue.failJob(job.id, 'Error');
      }

      const stats = queue.getStats();

      expect(stats.failed).toBe(1);
      expect(job.status).toBe('failed');
    });

    it('should track error messages', () => {
      const job = queue.enqueue('deploy-1', 1);
      queue.dequeue();
      queue.failJob(job.id, 'Deployment timeout');

      const retrieved = queue.getJob(job.id);

      expect(retrieved!.error).toBe('Deployment timeout');
    });
  });

  describe('Queue Statistics', () => {
    it('should track queue statistics', () => {
      queue.enqueue('deploy-1', 1);
      queue.enqueue('deploy-2', 1);
      queue.dequeue();

      const stats = queue.getStats();

      expect(stats.pending).toBe(1);
      expect(stats.processing).toBe(1);
      expect(stats.completed).toBe(0);
    });

    it('should update stats on job completion', () => {
      const job = queue.enqueue('deploy-1', 1);
      queue.dequeue();
      queue.completeJob(job.id);

      const stats = queue.getStats();

      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(1);
      expect(stats.totalProcessed).toBe(1);
    });
  });

  describe('Queue Cleanup', () => {
    it('should clear queue', () => {
      queue.enqueue('deploy-1', 1);
      queue.enqueue('deploy-2', 1);

      queue.clearQueue();

      expect(queue.getQueueSize()).toBe(0);
      expect(queue.getStats().pending).toBe(0);
    });

    it('should reset stats on clear', () => {
      const job = queue.enqueue('deploy-1', 1);
      queue.dequeue();
      queue.completeJob(job.id);

      queue.clearQueue();

      const stats = queue.getStats();

      expect(stats.completed).toBe(0);
      expect(stats.totalProcessed).toBe(0);
    });
  });

  describe('Queue Job Retrieval', () => {
    it('should retrieve job by ID', () => {
      const job = queue.enqueue('deploy-1', 1);
      const retrieved = queue.getJob(job.id);

      expect(retrieved).toEqual(job);
    });

    it('should return undefined for non-existent job', () => {
      const retrieved = queue.getJob('non-existent');

      expect(retrieved).toBeUndefined();
    });

    it('should track job timestamps', () => {
      const before = Date.now();
      const job = queue.enqueue('deploy-1', 1);
      const after = Date.now();

      expect(job.createdAt).toBeGreaterThanOrEqual(before);
      expect(job.createdAt).toBeLessThanOrEqual(after);
    });
  });
});

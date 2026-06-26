/**
 * Stellar Transaction Fee Estimation Tests
 *
 * Verifies fee calculation for all operation types, congestion-based
 * adjustment, minimum fee enforcement, estimation accuracy, and performance.
 *
 * No live network connection is required — Horizon fee-stats responses are
 * simulated in-memory.
 *
 * Fee estimation algorithm (documented):
 *   1. Fetch fee_stats from Horizon (/fee_stats endpoint).
 *   2. Select the percentile bucket matching the desired priority
 *      (low → p10, medium → p50, high → p90, urgent → p99).
 *   3. Multiply by the number of operations in the transaction.
 *   4. Clamp to [MIN_FEE_STROOPS, MAX_FEE_STROOPS].
 *   5. Under congestion (ledger_capacity_usage > CONGESTION_THRESHOLD),
 *      apply a congestion multiplier (default 1.5×).
 *
 * Stellar fee units: 1 XLM = 10 000 000 stroops. Base minimum = 100 stroops.
 */

import { describe, it, expect } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_FEE_STROOPS = 100;
const MAX_FEE_STROOPS = 100_000;
const CONGESTION_THRESHOLD = 0.8;
const CONGESTION_MULTIPLIER = 1.5;

// ── Types ─────────────────────────────────────────────────────────────────────

type FeePriority = 'low' | 'medium' | 'high' | 'urgent';

type OperationType =
  | 'payment'
  | 'create_account'
  | 'change_trust'
  | 'manage_sell_offer'
  | 'manage_buy_offer'
  | 'path_payment'
  | 'invoke_contract';

interface FeeStats {
  fee_charged: { p10: number; p50: number; p90: number; p99: number };
  ledger_capacity_usage: number; // 0–1
}

interface FeeEstimateRequest {
  operations: OperationType[];
  priority: FeePriority;
  feeStats: FeeStats;
}

interface FeeEstimateResult {
  totalFeeStroops: number;
  feePerOperationStroops: number;
  isCongested: boolean;
  priority: FeePriority;
  operationCount: number;
}

// ── Fee estimator ─────────────────────────────────────────────────────────────

function estimateFee(req: FeeEstimateRequest): FeeEstimateResult {
  const { operations, priority, feeStats } = req;

  const percentileMap: Record<FeePriority, number> = {
    low: feeStats.fee_charged.p10,
    medium: feeStats.fee_charged.p50,
    high: feeStats.fee_charged.p90,
    urgent: feeStats.fee_charged.p99,
  };

  const isCongested = feeStats.ledger_capacity_usage > CONGESTION_THRESHOLD;
  const basePerOp = percentileMap[priority];
  const adjustedPerOp = isCongested ? Math.ceil(basePerOp * CONGESTION_MULTIPLIER) : basePerOp;
  const feePerOp = Math.max(MIN_FEE_STROOPS, Math.min(MAX_FEE_STROOPS, adjustedPerOp));
  const total = Math.min(MAX_FEE_STROOPS, feePerOp * operations.length);

  return { totalFeeStroops: total, feePerOperationStroops: feePerOp, isCongested, priority, operationCount: operations.length };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFeeStats(feeOverrides: Partial<FeeStats['fee_charged']> = {}, capacityUsage = 0.3): FeeStats {
  return {
    fee_charged: { p10: 100, p50: 200, p90: 500, p99: 1_000, ...feeOverrides },
    ledger_capacity_usage: capacityUsage,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Fee estimation — operation types', () => {
  const feeStats = makeFeeStats();

  const cases: Array<[OperationType, FeePriority]> = [
    ['payment', 'medium'],
    ['create_account', 'medium'],
    ['change_trust', 'medium'],
    ['manage_sell_offer', 'medium'],
    ['manage_buy_offer', 'medium'],
    ['path_payment', 'high'],
    ['invoke_contract', 'high'],
  ];

  it.each(cases)('%s at %s priority returns a positive fee', (op, priority) => {
    const result = estimateFee({ operations: [op], priority, feeStats });
    expect(result.totalFeeStroops).toBeGreaterThan(0);
    expect(result.operationCount).toBe(1);
  });

  it('multi-operation transaction scales fee by operation count', () => {
    const single = estimateFee({ operations: ['payment'], priority: 'medium', feeStats });
    const multi = estimateFee({ operations: ['payment', 'change_trust', 'manage_sell_offer'], priority: 'medium', feeStats });
    expect(multi.totalFeeStroops).toBe(single.feePerOperationStroops * 3);
  });
});

describe('Fee estimation — priority levels', () => {
  const feeStats = makeFeeStats();

  it('low priority uses p10 fee', () => {
    expect(estimateFee({ operations: ['payment'], priority: 'low', feeStats }).feePerOperationStroops).toBe(feeStats.fee_charged.p10);
  });

  it('medium priority uses p50 fee', () => {
    expect(estimateFee({ operations: ['payment'], priority: 'medium', feeStats }).feePerOperationStroops).toBe(feeStats.fee_charged.p50);
  });

  it('high priority uses p90 fee', () => {
    expect(estimateFee({ operations: ['payment'], priority: 'high', feeStats }).feePerOperationStroops).toBe(feeStats.fee_charged.p90);
  });

  it('urgent priority uses p99 fee', () => {
    expect(estimateFee({ operations: ['payment'], priority: 'urgent', feeStats }).feePerOperationStroops).toBe(feeStats.fee_charged.p99);
  });

  it('higher priority always yields fee >= lower priority', () => {
    const priorities: FeePriority[] = ['low', 'medium', 'high', 'urgent'];
    const fees = priorities.map(p => estimateFee({ operations: ['payment'], priority: p, feeStats }).feePerOperationStroops);
    for (let i = 1; i < fees.length; i++) {
      expect(fees[i]).toBeGreaterThanOrEqual(fees[i - 1]);
    }
  });
});

describe('Fee estimation — congestion adjustment', () => {
  it('detects congestion when capacity usage exceeds threshold', () => {
    expect(estimateFee({ operations: ['payment'], priority: 'medium', feeStats: makeFeeStats({}, 0.85) }).isCongested).toBe(true);
  });

  it('does not flag congestion below threshold', () => {
    expect(estimateFee({ operations: ['payment'], priority: 'medium', feeStats: makeFeeStats({}, 0.5) }).isCongested).toBe(false);
  });

  it('applies congestion multiplier to fee when congested', () => {
    const normal = estimateFee({ operations: ['payment'], priority: 'medium', feeStats: makeFeeStats({}, 0.3) });
    const congested = estimateFee({ operations: ['payment'], priority: 'medium', feeStats: makeFeeStats({}, 0.9) });
    expect(congested.feePerOperationStroops).toBeGreaterThan(normal.feePerOperationStroops);
    expect(congested.feePerOperationStroops).toBe(Math.ceil(normal.feePerOperationStroops * CONGESTION_MULTIPLIER));
  });

  it('congestion multiplier is exactly 1.5×', () => {
    const base = 200;
    const result = estimateFee({ operations: ['payment'], priority: 'medium', feeStats: makeFeeStats({ p50: base }, 0.95) });
    expect(result.feePerOperationStroops).toBe(Math.ceil(base * 1.5));
  });
});

describe('Fee estimation — minimum fee enforcement', () => {
  it('enforces minimum fee of 100 stroops per operation', () => {
    const result = estimateFee({ operations: ['payment'], priority: 'low', feeStats: makeFeeStats({ p10: 10, p50: 20, p90: 50, p99: 80 }) });
    expect(result.feePerOperationStroops).toBeGreaterThanOrEqual(MIN_FEE_STROOPS);
  });

  it('minimum fee applies even under congestion with very low base', () => {
    const result = estimateFee({ operations: ['payment'], priority: 'low', feeStats: makeFeeStats({ p10: 1, p50: 2, p90: 5, p99: 8 }, 0.95) });
    expect(result.feePerOperationStroops).toBeGreaterThanOrEqual(MIN_FEE_STROOPS);
  });

  it('total fee does not exceed maximum cap', () => {
    const ops: OperationType[] = Array(50).fill('payment');
    const result = estimateFee({ operations: ops, priority: 'urgent', feeStats: makeFeeStats({ p99: 5_000 }) });
    expect(result.totalFeeStroops).toBeLessThanOrEqual(MAX_FEE_STROOPS);
  });
});

describe('Fee estimation — accuracy', () => {
  it('single payment at medium priority matches p50 exactly (no congestion)', () => {
    const feeStats = makeFeeStats({ p50: 300 });
    const result = estimateFee({ operations: ['payment'], priority: 'medium', feeStats });
    expect(result.totalFeeStroops).toBe(300);
    expect(result.feePerOperationStroops).toBe(300);
  });

  it('two operations at high priority totals 2× p90', () => {
    const feeStats = makeFeeStats({ p90: 400 });
    const result = estimateFee({ operations: ['payment', 'change_trust'], priority: 'high', feeStats });
    expect(result.totalFeeStroops).toBe(800);
  });

  it('congested urgent fee is ceil(p99 × 1.5)', () => {
    const p99 = 700;
    const result = estimateFee({ operations: ['invoke_contract'], priority: 'urgent', feeStats: makeFeeStats({ p99 }, 0.9) });
    expect(result.feePerOperationStroops).toBe(Math.ceil(p99 * 1.5));
  });
});

describe('Fee estimation — performance', () => {
  it('estimates fee for 1 000 requests within 50 ms', () => {
    const feeStats = makeFeeStats({}, 0.6);
    const start = performance.now();
    for (let i = 0; i < 1_000; i++) estimateFee({ operations: ['payment'], priority: 'medium', feeStats });
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('estimates fee for a 20-operation transaction within 5 ms', () => {
    const ops: OperationType[] = Array(20).fill('payment');
    const start = performance.now();
    estimateFee({ operations: ops, priority: 'high', feeStats: makeFeeStats({}, 0.85) });
    expect(performance.now() - start).toBeLessThan(5);
  });
});

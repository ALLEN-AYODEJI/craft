import { SorobanRpc } from 'stellar-sdk';

export interface BudgetLimits {
  maxCpuInstructions: number;
  maxMemoryBytes: number;
}

export interface BudgetUsage {
  cpuInstructions: number;
  memoryBytes: number;
}

export interface BudgetCheckResult {
  withinBudget: boolean;
  usage: BudgetUsage;
  limits: BudgetLimits;
  estimatedFee: string;
}

// Default conservative limits (Soroban network defaults as of Protocol 21)
export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxCpuInstructions: 100_000_000,
  maxMemoryBytes: 41_943_040, // 40 MB
};

/**
 * Extracts CPU and memory usage from a successful simulation response.
 */
export function extractBudgetUsage(
  simResult: SorobanRpc.Api.SimulateTransactionSuccessResponse
): BudgetUsage {
  const cost = simResult.cost;
  return {
    cpuInstructions: Number(cost?.cpuInsns ?? 0),
    memoryBytes: Number(cost?.memBytes ?? 0),
  };
}

/**
 * Validates that the simulated resource usage fits within the configured budget.
 */
export function checkBudget(
  simResult: SorobanRpc.Api.SimulateTransactionSuccessResponse,
  limits: BudgetLimits = DEFAULT_BUDGET_LIMITS
): BudgetCheckResult {
  const usage = extractBudgetUsage(simResult);
  const estimatedFee = simResult.minResourceFee ?? '0';

  const withinBudget =
    usage.cpuInstructions <= limits.maxCpuInstructions &&
    usage.memoryBytes <= limits.maxMemoryBytes;

  return { withinBudget, usage, limits, estimatedFee };
}

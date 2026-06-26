import * as StellarSdk from 'stellar-sdk';
import { SorobanRpc } from 'stellar-sdk';
import {
  BudgetLimits,
  DEFAULT_BUDGET_LIMITS,
  checkBudget,
  BudgetCheckResult,
} from './soroban-budget-monitor';

const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE ??
  StellarSdk.Networks.TESTNET;

export function createRpcServer(): SorobanRpc.Server {
  return new SorobanRpc.Server(SOROBAN_RPC_URL, { allowHttp: false });
}

export interface PreflightResult {
  budgetCheck: BudgetCheckResult;
  preparedTransaction: StellarSdk.Transaction;
}

/**
 * Runs pre-flight simulation on a Soroban transaction.
 * Validates budget consumption and returns the fee-stamped transaction ready for submission.
 *
 * @throws if simulation fails or budget is exceeded.
 */
export async function preflightTransaction(
  transaction: StellarSdk.Transaction,
  budgetLimits: BudgetLimits = DEFAULT_BUDGET_LIMITS,
  rpc: SorobanRpc.Server = createRpcServer()
): Promise<PreflightResult> {
  const simResult = await rpc.simulateTransaction(transaction);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    throw new Error('Simulation returned an unexpected response');
  }

  const budgetCheck = checkBudget(simResult, budgetLimits);

  if (!budgetCheck.withinBudget) {
    throw new Error(
      `Contract call exceeds budget — ` +
        `CPU: ${budgetCheck.usage.cpuInstructions}/${budgetCheck.limits.maxCpuInstructions} instructions, ` +
        `Memory: ${budgetCheck.usage.memoryBytes}/${budgetCheck.limits.maxMemoryBytes} bytes`
    );
  }

  const preparedTransaction = SorobanRpc.assembleTransaction(
    transaction,
    simResult
  ).build();

  return { budgetCheck, preparedTransaction };
}

/**
 * Prepares and submits a Soroban contract invocation with pre-flight budget enforcement.
 * The caller must sign `preparedTransaction` before calling this.
 */
export async function invokeContract(
  transaction: StellarSdk.Transaction,
  signerKeypair: StellarSdk.Keypair,
  budgetLimits: BudgetLimits = DEFAULT_BUDGET_LIMITS,
  rpc: SorobanRpc.Server = createRpcServer()
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  const { preparedTransaction } = await preflightTransaction(
    transaction,
    budgetLimits,
    rpc
  );

  preparedTransaction.sign(signerKeypair);

  const sendResponse = await rpc.sendTransaction(preparedTransaction);

  if (sendResponse.status === 'ERROR') {
    throw new Error(`Transaction submission failed: ${sendResponse.errorResult}`);
  }

  // Poll for finality
  let getResponse = await rpc.getTransaction(sendResponse.hash);
  while (getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 1000));
    getResponse = await rpc.getTransaction(sendResponse.hash);
  }

  if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
    throw new Error('Transaction failed on-chain');
  }

  return getResponse;
}

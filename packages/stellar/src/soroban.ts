import { SorobanRpc, Contract, Transaction, TransactionBuilder, Networks, BASE_FEE, xdr, hash, StrKey } from 'stellar-sdk';
import { config } from './config';
import { parseStellarError } from './errors';

// Minimal AppError shape — matches apps/backend/src/lib/api/retryable-error.ts
export interface AppError {
    status?: number;
    message: string;
    code?: string;
}

export type InvokeContractResult<T = SorobanRpc.Api.SimulateTransactionResponse> =
    | { ok: true; result: T }
    | { ok: false; error: AppError };

/**
 * Maximum Soroban contract WASM binary size in bytes.
 * Based on Soroban network deployment constraints.
 * @see https://developers.stellar.org/docs/smart-contracts/limits-and-fees
 */
export const MAX_WASM_SIZE_BYTES = 65536; // 64 KB

export interface WasmValidationResult {
    valid: boolean;
    size?: number;
    maxSize: number;
    error?: string;
}

const SOROBAN_RPC_URLS = {
    mainnet: 'https://soroban-mainnet.stellar.org',
    testnet: 'https://soroban-testnet.stellar.org',
} as const;

function getSorobanRpcUrl(): string {
    return (
        process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ||
        SOROBAN_RPC_URLS[config.stellar.network]
    );
}

function getNetworkPassphrase(): string {
    return config.stellar.network === 'mainnet'
        ? Networks.PUBLIC
        : Networks.TESTNET;
}

/**
 * Creates a Soroban RPC server instance for the configured network.
 */
export function createSorobanClient(): SorobanRpc.Server {
    return new SorobanRpc.Server(getSorobanRpcUrl(), { allowHttp: false });
}

export const sorobanClient = createSorobanClient();

// ---------------------------------------------------------------------------
// Contract State Simulation Cache
// ---------------------------------------------------------------------------
//
// A short-lived in-memory cache for `simulateContractCall` results.
//
// Design notes:
//  - Key  : `${contractId}:${method}:${JSON.stringify(args)}:${sourcePublicKey}`
//  - TTL  : CACHE_TTL_MS (default 5 000 ms). Entries older than this are
//           considered stale and bypassed on the next read.
//  - Size : MAX_CACHE_ENTRIES (default 1 000). When the limit is reached the
//           oldest entry (first inserted, because Map preserves insertion
//           order) is evicted before a new entry is stored.
//  - Eviction is lazy – stale entries are only removed when they are accessed
//           or when a new entry would exceed MAX_CACHE_ENTRIES.
//
// Call `clearCache()` to flush all entries (e.g. in test teardown).
// ---------------------------------------------------------------------------

/** Maximum number of entries held at once. Older entries are evicted first. */
const MAX_CACHE_ENTRIES = 1_000;

/** Time-to-live for each cache entry in milliseconds. */
const CACHE_TTL_MS = 5_000;

interface SimulationCacheEntry {
    response: SorobanRpc.Api.SimulateTransactionResponse;
    /** Unix timestamp (ms) of when the entry was stored. */
    storedAt: number;
}

const simulationCache = new Map<string, SimulationCacheEntry>();

/** Build the cache key from the call parameters. */
function buildCacheKey(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string
): string {
    // Serialise args to their base64 XDR representations for a stable key.
    const argsKey = args.map((a) => a.toXDR('base64')).join(',');
    return `${contractId}:${method}:${argsKey}:${sourcePublicKey}`;
}

/**
 * Evict a single entry by key if it exists – used when making room for a new
 * entry that would exceed the size cap.
 */
function evictOldest(): void {
    const firstKey = simulationCache.keys().next().value;
    if (firstKey !== undefined) {
        simulationCache.delete(firstKey);
    }
}

/**
 * Clear all cached simulation results.
 * Call this in test teardown to ensure isolation between test cases.
 */
export function clearCache(): void {
    simulationCache.clear();
}

/**
 * Simulates a contract invocation without submitting to the network.
 *
 * Results are cached for CACHE_TTL_MS to avoid redundant RPC round-trips
 * during the preview and deployment flows. The cache is keyed on
 * (contractId, method, args, sourcePublicKey).
 *
 * @param contractId - The contract address (C...)
 * @param method - The contract method name
 * @param args - XDR-encoded method arguments
 * @param sourcePublicKey - The source account public key
 */
export async function simulateContractCall(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string
): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    const cacheKey = buildCacheKey(contractId, method, args, sourcePublicKey);
    const now = Date.now();

    // Cache hit – return the stored response if still within TTL.
    const cached = simulationCache.get(cacheKey);
    if (cached && now - cached.storedAt < CACHE_TTL_MS) {
        return cached.response;
    }

    // Cache miss (or stale) – fetch from RPC.
    const account = await sorobanClient.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

    const response = await sorobanClient.simulateTransaction(tx);

    // Evict the oldest entry first if we are at capacity.
    if (simulationCache.size >= MAX_CACHE_ENTRIES) {
        evictOldest();
    }

    simulationCache.set(cacheKey, { response, storedAt: now });
    return response;
}

/**
 * Performs a dry-run simulation of a Soroban contract invocation.
 * Detects errors and estimates resources before actual deployment.
 *
 * @param contractId - The contract address (C...)
 * @param method - The contract method name
 * @param args - XDR-encoded method arguments
 * @param sourcePublicKey - The source account public key
 * @returns Simulation result with success status, errors, and resource estimates
 *
 * @example
 * ```typescript
 * const dryRun = await performContractDryRun(contractId, 'transfer', args, pubKey);
 * if (!dryRun.success) {
 *   console.error('Simulation failed:', dryRun.error);
 *   return; // Block deployment
 * }
 * console.log('Estimated fee:', dryRun.resourceEstimate?.fee);
 * ```
 */
export async function performContractDryRun(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string
): Promise<{
    success: boolean;
    error?: string;
    resourceEstimate?: {
        cpuInstructions?: string;
        memoryBytes?: string;
        fee?: string;
    };
    result?: SorobanRpc.Api.SimulateTransactionResponse;
}> {
    try {
        const simulation = await simulateContractCall(
            contractId,
            method,
            args,
            sourcePublicKey
        );

        // Check for simulation errors
        if (SorobanRpc.Api.isSimulationError(simulation)) {
            return {
                success: false,
                error: `Contract simulation failed: ${simulation.error}`,
                result: simulation,
            };
        }

        // Extract resource estimates if available
        const resourceEstimate: any = {};
        if ('cost' in simulation && simulation.cost) {
            resourceEstimate.cpuInstructions = simulation.cost.cpuInsns;
            resourceEstimate.memoryBytes = simulation.cost.memBytes;
        }
        if ('minResourceFee' in simulation) {
            resourceEstimate.fee = simulation.minResourceFee;
        }

        return {
            success: true,
            resourceEstimate,
            result: simulation,
        };
    } catch (error: unknown) {
        const parsed = parseStellarError(error);
        return {
            success: false,
            error: `Dry-run failed: ${parsed.message}`,
        };
    }
}

/**
 * Prepares and submits a contract invocation transaction.
 * Caller is responsible for signing the prepared transaction before submission.
 *
 * @param contractId - The contract address (C...)
 * @param method - The contract method name
 * @param args - XDR-encoded method arguments
 * @param sourcePublicKey - The source account public key
 * @returns The prepared (unsigned) transaction ready for signing
 */
export async function prepareContractCall(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string
): Promise<ReturnType<typeof TransactionBuilder.prototype.build>> {
    const account = await sorobanClient.getAccount(sourcePublicKey);
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
    })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

    return sorobanClient.prepareTransaction(tx);
}

/**
 * Sends a signed transaction to the Soroban RPC and polls for the result.
 *
 * @param signedTxXdr - The signed transaction in XDR format
 */
export async function sendSorobanTransaction(
    signedTxXdr: string
): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const tx = TransactionBuilder.fromXDR(signedTxXdr, getNetworkPassphrase());
    const sendResult = await sorobanClient.sendTransaction(tx);

    if (sendResult.status === 'ERROR') {
        throw new Error(`Transaction submission failed: ${sendResult.errorResult?.toXDR('base64')}`);
    }

    // Poll for transaction result
    let getResult = await sorobanClient.getTransaction(sendResult.hash);
    const deadline = Date.now() + 30_000;

    while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        if (Date.now() > deadline) {
            throw new Error(`Transaction ${sendResult.hash} not found after 30s`);
        }
        await new Promise((r) => setTimeout(r, 1000));
        getResult = await sorobanClient.getTransaction(sendResult.hash);
    }

    return getResult;
}

/**
 * Invoke a Soroban contract method via simulation and return a typed result.
 *
 * Wraps `simulateContractCall` and maps any RPC error through `parseStellarError`
 * so callers receive a discriminated union instead of a raw thrown error.
 *
 * @param contractId - The contract address (C...)
 * @param method - The contract method name
 * @param args - XDR-encoded method arguments
 * @param sourcePublicKey - The source account public key
 * @param _simulate - Optional override for `simulateContractCall` (for testing)
 * @returns `{ ok: true, result }` on success or `{ ok: false, error: AppError }` on failure
 *
 * @example
 * ```typescript
 * const res = await invokeContractMethod(contractId, 'transfer', args, pubKey);
 * if (!res.ok) {
 *   console.error(res.error.message); // typed, user-friendly message
 * }
 * ```
 */
export async function invokeContractMethod(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string,
    _simulate: typeof simulateContractCall = simulateContractCall,
): Promise<InvokeContractResult> {
    try {
        const result = await _simulate(contractId, method, args, sourcePublicKey);
        return { ok: true, result };
    } catch (raw: unknown) {
        const parsed = parseStellarError(raw);
        return {
            ok: false,
            error: {
                message: parsed.message,
                code: parsed.code,
                // Map retryable network/rate-limit errors to an HTTP-like status
                // so callers using isRetryableError(AppError) work correctly.
                status: parsed.retryable && parsed.code === 'RATE_LIMITED' ? 429
                    : parsed.retryable && parsed.code === 'CONNECTION_TIMEOUT' ? undefined
                    : parsed.retryable ? undefined
                    : 400,
            },
        };
    }
}

/**
 * Validates Soroban contract WASM binary size against network deployment constraints.
 *
 * @param wasmBinary - The WASM binary as Buffer or Uint8Array
 * @returns Validation result with size information and error details
 *
 * @example
 * ```typescript
 * const wasm = fs.readFileSync('contract.wasm');
 * const result = validateWasmSize(wasm);
 * if (!result.valid) {
 *   console.error(result.error);
 *   console.log(`Binary size: ${result.size} bytes, Max: ${result.maxSize} bytes`);
 * }
 * ```
 */
export function validateWasmSize(wasmBinary: Buffer | Uint8Array): WasmValidationResult {
    const size = wasmBinary.length;

    if (size > MAX_WASM_SIZE_BYTES) {
        return {
            valid: false,
            size,
            maxSize: MAX_WASM_SIZE_BYTES,
            error: `WASM binary size (${size} bytes) exceeds maximum allowed size (${MAX_WASM_SIZE_BYTES} bytes). Reduce contract size by ${size - MAX_WASM_SIZE_BYTES} bytes.`,
        };
    }

    return {
        valid: true,
        size,
        maxSize: MAX_WASM_SIZE_BYTES,
    };
}

/**
 * Validates WASM binary before deployment and throws if invalid.
 *
 * @param wasmBinary - The WASM binary to validate
 * @throws Error if WASM binary exceeds size limit
 *
 * @example
 * ```typescript
 * try {
 *   assertValidWasmSize(wasmBinary);
 *   // Proceed with deployment
 * } catch (error) {
 *   console.error('Deployment blocked:', error.message);
 * }
 * ```
 */
export function assertValidWasmSize(wasmBinary: Buffer | Uint8Array): void {
    const result = validateWasmSize(wasmBinary);
    if (!result.valid) {
        throw new Error(result.error);
    }
}

// ---------------------------------------------------------------------------
// Fee Bump Transaction Builder (#618)
// ---------------------------------------------------------------------------

/**
 * Maximum fee (in stroops) allowed for a fee bump transaction.
 * Prevents runaway costs under extreme network congestion.
 * 1 XLM = 10_000_000 stroops; cap at 1 XLM per transaction.
 */
export const MAX_FEE_BUMP_STROOPS = 10_000_000;

/**
 * Multiplier applied to the network's p90 fee to derive the bump fee.
 * Balances cost efficiency with reliable confirmation speed.
 */
const FEE_MULTIPLIER = 1.5;

export type FeeBumpResult =
    | { ok: true; feeBumpXdr: string; feeCharged: number }
    | { ok: false; error: string };

/**
 * Fee Bump Transaction Builder for Soroban contract invocations.
 *
 * ## Fee Strategy
 * 1. Query the Soroban RPC for recent fee statistics (p10/p50/p90).
 * 2. Multiply the p90 fee by `FEE_MULTIPLIER` (1.5×) to stay ahead of
 *    congestion while avoiding overpayment.
 * 3. Cap the result at `MAX_FEE_BUMP_STROOPS` (1 XLM) to prevent runaway costs.
 * 4. Wrap the inner transaction in a `FeeBumpTransaction` using the computed fee.
 *
 * Under low congestion the p90 fee is small, so the bump fee stays cheap.
 * Under high congestion the cap prevents excessive spend.
 *
 * @param innerTxXdr - Signed inner transaction XDR that needs a fee bump
 * @param feeSourcePublicKey - Account that pays the bumped fee
 * @param client - Optional Soroban RPC client override (for testing)
 * @returns Fee bump transaction XDR or an error description
 */
export async function buildFeeBumpTransaction(
    innerTxXdr: string,
    feeSourcePublicKey: string,
    client: SorobanRpc.Server = sorobanClient,
): Promise<FeeBumpResult> {
    try {
        // Query network fee statistics to determine an appropriate fee.
        const feeStats = await client.getFeeStats();
        const p90Fee = Number(feeStats.sorobanInclusionFee?.p90 ?? feeStats.inclusionFee?.p90 ?? BASE_FEE);

        // Apply multiplier then enforce the cap.
        const rawFee = Math.ceil(p90Fee * FEE_MULTIPLIER);
        const feeCharged = Math.min(rawFee, MAX_FEE_BUMP_STROOPS);

        const innerTx = TransactionBuilder.fromXDR(innerTxXdr, getNetworkPassphrase());

        const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
            feeSourcePublicKey,
            feeCharged.toString(),
            innerTx as Transaction,
            getNetworkPassphrase(),
        );

        return { ok: true, feeBumpXdr: feeBumpTx.toXDR(), feeCharged };
    } catch (error: unknown) {
        const parsed = parseStellarError(error);
        return { ok: false, error: parsed.message };
    }
}

// ---------------------------------------------------------------------------
// Contract Address Derivation (#613)
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic Soroban contract address from the deployer's public
 * key, a 32-byte salt, and the contract's 32-byte WASM hash.
 *
 * The address is produced by SHA-256 hashing the concatenation of the three
 * inputs and encoding the result as a Stellar contract StrKey (C…).
 *
 * @param deployer   - Stellar G-key of the deploying account
 * @param salt       - 32-byte salt as a hex string or Buffer
 * @param wasmHash   - 32-byte WASM hash as a hex string or Buffer
 * @returns          Contract address as a C… StrKey (56 chars)
 * @throws           When salt or wasmHash is not exactly 32 bytes
 */
export function deriveContractAddress(
    deployer: string,
    salt: string | Buffer,
    wasmHash: string | Buffer,
): string {
    const saltBytes = Buffer.isBuffer(salt) ? salt : Buffer.from(salt as string, 'hex');
    const wasmBytes = Buffer.isBuffer(wasmHash) ? wasmHash : Buffer.from(wasmHash as string, 'hex');

    if (saltBytes.length !== 32) throw new Error('salt must be 32 bytes');
    if (wasmBytes.length !== 32) throw new Error('wasmHash must be 32 bytes');

    const deployerBytes = StrKey.decodeEd25519PublicKey(deployer);
    const preimage = Buffer.concat([deployerBytes, saltBytes, wasmBytes]);
    const contractId = hash(preimage);
    return StrKey.encodeContract(contractId);
}

/**
 * Verify that a deployed contract address matches what would be derived from
 * the given deployer, salt, and WASM hash.
 *
 * @param deployer  - Stellar G-key of the deploying account
 * @param salt      - 32-byte salt as a hex string or Buffer
 * @param wasmHash  - 32-byte WASM hash as a hex string or Buffer
 * @param deployed  - Contract address to verify (C… StrKey)
 * @returns         `true` when the address matches the derivation
 */
export function verifyContractAddress(
    deployer: string,
    salt: string | Buffer,
    wasmHash: string | Buffer,
    deployed: string,
): boolean {
    return deriveContractAddress(deployer, salt, wasmHash) === deployed;
}

// ---------------------------------------------------------------------------
// WASM Binary Size Optimization Validation Pipeline (#776)
// ---------------------------------------------------------------------------

/** WASM section type IDs as defined in the WebAssembly binary format spec. */
const WASM_SECTION = {
  CUSTOM: 0,
  TYPE: 1,
  IMPORT: 2,
  FUNCTION: 3,
  TABLE: 4,
  MEMORY: 5,
  GLOBAL: 6,
  EXPORT: 7,
  START: 8,
  ELEMENT: 9,
  CODE: 10,
  DATA: 11,
  DATA_COUNT: 12,
} as const;

/** Known Soroban host function import module name. */
const SOROBAN_HOST_MODULE = 'v';

export interface WasmSectionBreakdown {
  /** Code section size in bytes (function bodies). */
  codeSection: number;
  /** Data section size in bytes (initialized memory segments). */
  dataSection: number;
  /** Import section size in bytes. */
  importSection: number;
  /** Sum of all custom section sizes in bytes (debug info, names, etc.). */
  customSections: number;
  /** Total binary size in bytes. */
  total: number;
}

export type OptimizationAction =
  | 'strip-debug-info'
  | 'enable-wasm-opt'
  | 'remove-unused-imports';

export interface WasmOptimizationIssue {
  type: 'unused-import' | 'debug-section' | 'unoptimized-data' | 'redundant-types';
  description: string;
  /** Estimated byte savings if the issue is resolved. */
  estimatedSavings: number;
  action: OptimizationAction;
}

export interface WasmOptimizationReport {
  /** True when the binary passes the size limit. */
  withinLimit: boolean;
  sizeBreakdown: WasmSectionBreakdown;
  issues: WasmOptimizationIssue[];
  suggestions: OptimizationAction[];
  /** Total estimated savings across all issues, in bytes. */
  totalEstimatedSavings: number;
}

/** Read a LEB128 unsigned integer from a DataView, returning [value, bytesRead]. */
function readULEB128(view: DataView, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < view.byteLength) {
    const byte = view.getUint8(offset + bytesRead);
    bytesRead++;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift >= 35) break; // safety: cap at 5 bytes for u32
  }
  return [result, bytesRead];
}

/** Minimal UTF-8 string reader from a DataView. */
function readString(view: DataView, offset: number, len: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, len);
  return typeof TextDecoder !== 'undefined'
    ? new TextDecoder().decode(bytes)
    : Buffer.from(bytes).toString('utf8');
}

/**
 * Analyzes a WASM binary for size optimization opportunities.
 *
 * Parses the WASM section table to build a size breakdown and detect:
 * - Custom sections (debug info, name section) that can be stripped
 * - Import section entries that reference unused host function modules
 * - Oversized data segments relative to code
 * - Redundant type section entries
 *
 * Runs in O(n) over the binary length and completes well under 2 seconds
 * for a 64 KB binary.
 *
 * @param wasmBinary - Raw WASM bytes
 * @returns Optimization report with section breakdown, issues, and suggestions
 *
 * @example
 * ```typescript
 * const report = analyzeWasmOptimization(fs.readFileSync('contract.wasm'));
 * if (report.issues.length > 0) {
 *   console.log('Suggestions:', report.suggestions);
 *   console.log('Potential savings:', report.totalEstimatedSavings, 'bytes');
 * }
 * ```
 */
export function analyzeWasmOptimization(wasmBinary: Buffer | Uint8Array): WasmOptimizationReport {
  const buf = wasmBinary instanceof Buffer ? wasmBinary : Buffer.from(wasmBinary);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const total = buf.length;

  const breakdown: WasmSectionBreakdown = {
    codeSection: 0,
    dataSection: 0,
    importSection: 0,
    customSections: 0,
    total,
  };

  const issues: WasmOptimizationIssue[] = [];

  // Validate WASM magic + version (8 bytes header)
  // WASM magic bytes: 0x00 0x61 0x73 0x6d (\0asm), read as big-endian uint32
  const WASM_MAGIC = 0x0061736d;
  if (total < 8 || view.getUint32(0, false) !== WASM_MAGIC) {
    return {
      withinLimit: total <= MAX_WASM_SIZE_BYTES,
      sizeBreakdown: breakdown,
      issues,
      suggestions: [],
      totalEstimatedSavings: 0,
    };
  }

  let offset = 8;
  let importCount = 0;
  let sorobanImportCount = 0;
  let typeCount = 0;
  let funcCount = 0;

  // Walk section table
  while (offset < total - 1) {
    if (offset >= total) break;
    const sectionId = view.getUint8(offset);
    offset += 1;

    const [sectionSize, szBytes] = readULEB128(view, offset);
    offset += szBytes;

    const sectionStart = offset;

    if (sectionId === WASM_SECTION.CODE) {
      breakdown.codeSection += sectionSize;
    } else if (sectionId === WASM_SECTION.DATA) {
      breakdown.dataSection += sectionSize;
    } else if (sectionId === WASM_SECTION.IMPORT) {
      breakdown.importSection += sectionSize;
      // Scan imports to detect host function usage
      let pos = sectionStart;
      const [count, cb] = readULEB128(view, pos);
      pos += cb;
      importCount += count;
      for (let i = 0; i < count && pos < sectionStart + sectionSize; i++) {
        const [modLen, mb] = readULEB128(view, pos); pos += mb;
        const modName = pos + modLen <= total ? readString(view, pos, modLen) : '';
        pos += modLen;
        const [fldLen, fb] = readULEB128(view, pos); pos += fb;
        pos += fldLen; // skip field name
        const importKind = pos < total ? view.getUint8(pos) : 0; pos += 1;
        if (importKind === 0 /* function */) {
          pos += readULEB128(view, pos)[1]; // skip type index
          if (modName === SOROBAN_HOST_MODULE) sorobanImportCount++;
        } else if (importKind === 1 /* table */ || importKind === 3 /* global */) {
          pos += 2; // skip reftype/valtype + mutability
        } else if (importKind === 2 /* memory */) {
          const flags = pos < total ? view.getUint8(pos) : 0; pos += 1;
          pos += readULEB128(view, pos)[1]; // min
          if (flags & 1) pos += readULEB128(view, pos)[1]; // max
        }
      }
    } else if (sectionId === WASM_SECTION.TYPE) {
      const [tc] = readULEB128(view, sectionStart);
      typeCount = tc;
    } else if (sectionId === WASM_SECTION.FUNCTION) {
      const [fc] = readULEB128(view, sectionStart);
      funcCount = fc;
    } else if (sectionId === WASM_SECTION.CUSTOM) {
      breakdown.customSections += sectionSize;
      // Read custom section name to distinguish debug/name sections
      let pos = sectionStart;
      const [nameLen, nb] = readULEB128(view, pos); pos += nb;
      const name = pos + nameLen <= total ? readString(view, pos, nameLen) : '';
      if (name === 'name' || name.startsWith('.debug') || name === 'producers') {
        issues.push({
          type: 'debug-section',
          description: `Custom section "${name}" (${sectionSize} bytes) contains debug/metadata info that can be stripped`,
          estimatedSavings: sectionSize,
          action: 'strip-debug-info',
        });
      }
    }

    offset = sectionStart + sectionSize;
    if (sectionSize === 0 && sectionId === 0) break; // malformed, stop
  }

  // Detect unused host function imports: if soroban imports >> funcs used, flag it
  // Heuristic: if import section is > 15% of total binary, flag for wasm-opt
  if (breakdown.importSection > 0 && breakdown.importSection > total * 0.15) {
    issues.push({
      type: 'unused-import',
      description: `Import section is ${breakdown.importSection} bytes (${Math.round(breakdown.importSection / total * 100)}% of binary). Run wasm-opt to remove unused host function imports`,
      estimatedSavings: Math.floor(breakdown.importSection * 0.3),
      action: 'remove-unused-imports',
    });
  }

  // Detect unoptimized data segments: data > 40% of total is unusual
  if (breakdown.dataSection > 0 && breakdown.dataSection > total * 0.4) {
    issues.push({
      type: 'unoptimized-data',
      description: `Data section is ${breakdown.dataSection} bytes (${Math.round(breakdown.dataSection / total * 100)}% of binary). Consider using lazy initialization or reducing static data`,
      estimatedSavings: Math.floor(breakdown.dataSection * 0.2),
      action: 'enable-wasm-opt',
    });
  }

  // Detect redundant types: if type count > 2× function count
  if (typeCount > 0 && funcCount > 0 && typeCount > funcCount * 2) {
    issues.push({
      type: 'redundant-types',
      description: `Type section has ${typeCount} entries for ${funcCount} functions. ${typeCount - funcCount} potentially redundant type definitions`,
      estimatedSavings: (typeCount - funcCount) * 4,
      action: 'enable-wasm-opt',
    });
  }

  // If no specific issues but binary is large, recommend wasm-opt generally
  if (issues.length === 0 && total > MAX_WASM_SIZE_BYTES * 0.75) {
    issues.push({
      type: 'unoptimized-data',
      description: `Binary is ${total} bytes (${Math.round(total / MAX_WASM_SIZE_BYTES * 100)}% of limit). Run wasm-opt -Os for general size reduction`,
      estimatedSavings: Math.floor(total * 0.1),
      action: 'enable-wasm-opt',
    });
  }

  const suggestions = [...new Set(issues.map((i) => i.action))] as OptimizationAction[];
  const totalEstimatedSavings = issues.reduce((sum, i) => sum + i.estimatedSavings, 0);

  return {
    withinLimit: total <= MAX_WASM_SIZE_BYTES,
    sizeBreakdown: breakdown,
    issues,
    suggestions,
    totalEstimatedSavings,
  };
}

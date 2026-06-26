/**
 * Property-Based Fuzz Testing for SorobanContractValidator
 *
 * Uses fast-check to generate arbitrary contract addresses, RPC responses,
 * and network conditions to expose edge cases in the validator service.
 *
 * Invariants tested:
 * 1. Valid contract addresses always pass format validation
 * 2. Invalid contract addresses always fail format validation
 * 3. Format validation never throws (always returns a result)
 * 4. checkExistence never throws (always returns a result)
 * 5. Malformed RPC responses are handled gracefully
 * 6. Network errors are caught and reported
 * 7. Contract address validation is idempotent
 * 8. Error results always include a reason or error message
 *
 * Issue: #538
 */

import { describe, it, expect } from 'vitest';
import { fc } from '@fast-check/vitest';
import { SorobanContractValidator } from './soroban-contract-validator.service';
import {
    arbValidContractAddress,
    arbInvalidContractAddress,
    arbRpcUrl,
    arbSorobanRpcResponse,
    arbHttpStatusCode,
    arbNetworkError,
} from './__fixtures__/soroban-contract-arbitraries';

describe('SorobanContractValidator — Property-Based Fuzz Testing', () => {
    const validator = new SorobanContractValidator();

    // ── Invariant 1: Valid contract addresses always pass format validation ──
    it(
        'should accept all valid contract addresses',
        fc.property(arbValidContractAddress(), (address) => {
            const result = validator.validateFormat(address);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        }),
    );

    // ── Invariant 2: Invalid contract addresses always fail format validation ──
    it(
        'should reject all invalid contract addresses',
        fc.property(arbInvalidContractAddress(), (address) => {
            const result = validator.validateFormat(address);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error?.code).toBeTruthy();
            expect(result.error?.reason).toBeTruthy();
        }),
    );

    // ── Invariant 3: Format validation never throws ──
    it(
        'should never throw during format validation',
        fc.property(fc.anything(), (input) => {
            expect(() => {
                validator.validateFormat(input);
            }).not.toThrow();
        }),
    );

    // ── Invariant 4: checkExistence never throws ──
    it(
        'should never throw during existence check',
        fc.property(
            fc.oneof(arbValidContractAddress(), arbInvalidContractAddress()),
            arbRpcUrl(),
            async (address, rpcUrl) => {
                const mockFetch = async () => ({
                    ok: true,
                    json: async () => ({ result: { entries: [] } }),
                });
                const validatorWithMock = new SorobanContractValidator(mockFetch as any);
                await expect(
                    validatorWithMock.checkExistence(address, rpcUrl),
                ).resolves.toBeDefined();
            },
        ),
    );

    // ── Invariant 5: Malformed RPC responses are handled gracefully ──
    it(
        'should handle malformed RPC responses without throwing',
        fc.property(arbSorobanRpcResponse(), async (response) => {
            const mockFetch = async () => ({
                ok: true,
                json: async () => response,
            });
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            const result = await validatorWithMock.checkExistence(
                'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'https://soroban-testnet.stellar.org',
            );
            expect(result).toBeDefined();
            expect(typeof result.exists).toBe('boolean');
            expect(typeof result.callable).toBe('boolean');
        }),
    );

    // ── Invariant 6: Network errors are caught and reported ──
    it(
        'should catch network errors and return a result',
        fc.property(arbNetworkError(), async (error) => {
            const mockFetch = async () => {
                throw error;
            };
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            const result = await validatorWithMock.checkExistence(
                'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'https://soroban-testnet.stellar.org',
            );
            expect(result.exists).toBe(false);
            expect(result.callable).toBe(false);
            expect(result.error).toBeDefined();
        }),
    );

    // ── Invariant 7: Contract address validation is idempotent ──
    it(
        'should return the same result when validating the same address twice',
        fc.property(
            fc.oneof(arbValidContractAddress(), arbInvalidContractAddress()),
            (address) => {
                const result1 = validator.validateFormat(address);
                const result2 = validator.validateFormat(address);
                expect(result1.valid).toBe(result2.valid);
                if (result1.error && result2.error) {
                    expect(result1.error.code).toBe(result2.error.code);
                }
            },
        ),
    );

    // ── Invariant 8: Error results always include a reason or error message ──
    it(
        'should include error details in all failure cases',
        fc.property(arbInvalidContractAddress(), (address) => {
            const result = validator.validateFormat(address);
            if (!result.valid) {
                expect(result.error).toBeDefined();
                expect(result.error?.reason || result.error?.code).toBeTruthy();
            }
        }),
    );

    // ── Invariant 9: HTTP error responses are handled correctly ──
    it(
        'should handle HTTP errors gracefully',
        fc.property(arbHttpStatusCode(), async (statusCode) => {
            const mockFetch = async () => ({
                ok: statusCode >= 200 && statusCode < 300,
                status: statusCode,
                json: async () => ({ error: { code: -32600, message: 'Error' } }),
            });
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            const result = await validatorWithMock.checkExistence(
                'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'https://soroban-testnet.stellar.org',
            );
            expect(result).toBeDefined();
            expect(typeof result.exists).toBe('boolean');
        }),
    );

    // ── Invariant 10: Valid addresses always have contractId set ──
    it(
        'should always set contractId in existence check result',
        fc.property(arbValidContractAddress(), async (address) => {
            const mockFetch = async () => ({
                ok: true,
                json: async () => ({ result: { entries: [] } }),
            });
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            const result = await validatorWithMock.checkExistence(address, 'https://soroban-testnet.stellar.org');
            expect(result.contractId).toBe(address);
        }),
    );

    // ── Invariant 11: Format validation result structure is consistent ──
    it(
        'should always return a result with valid property',
        fc.property(fc.anything(), (input) => {
            const result = validator.validateFormat(input);
            expect(result).toHaveProperty('valid');
            expect(typeof result.valid).toBe('boolean');
            if (!result.valid) {
                expect(result).toHaveProperty('error');
                expect(result.error).toHaveProperty('code');
                expect(result.error).toHaveProperty('reason');
                expect(result.error).toHaveProperty('guidance');
            }
        }),
    );

    // ── Invariant 12: Existence check result structure is consistent ──
    it(
        'should always return a result with exists and callable properties',
        fc.property(
            fc.oneof(arbValidContractAddress(), arbInvalidContractAddress()),
            async (address) => {
                const mockFetch = async () => ({
                    ok: true,
                    json: async () => ({ result: { entries: [] } }),
                });
                const validatorWithMock = new SorobanContractValidator(mockFetch as any);
                const result = await validatorWithMock.checkExistence(address, 'https://soroban-testnet.stellar.org');
                expect(result).toHaveProperty('exists');
                expect(result).toHaveProperty('callable');
                expect(result).toHaveProperty('contractId');
                expect(typeof result.exists).toBe('boolean');
                expect(typeof result.callable).toBe('boolean');
            },
        ),
    );

    // ── Invariant 13: Invalid format always results in exists: false ──
    it(
        'should return exists: false for invalid contract addresses',
        fc.property(arbInvalidContractAddress(), async (address) => {
            const mockFetch = async () => ({
                ok: true,
                json: async () => ({ result: { entries: [{ xdr: 'abc' }] } }),
            });
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            const result = await validatorWithMock.checkExistence(address, 'https://soroban-testnet.stellar.org');
            expect(result.exists).toBe(false);
        }),
    );

    // ── Invariant 14: Callable is only true when entries exist ──
    it(
        'should only set callable: true when entries are present',
        fc.property(async (fc) => {
            const hasEntries = fc.boolean();
            const mockFetch = async () => ({
                ok: true,
                json: async () => ({
                    result: {
                        entries: hasEntries ? [{ xdr: 'abc' }] : [],
                    },
                }),
            });
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            const result = await validatorWithMock.checkExistence(
                'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'https://soroban-testnet.stellar.org',
            );
            expect(result.callable).toBe(hasEntries);
        }),
    );

    // ── Invariant 15: Non-string inputs are always rejected ──
    it(
        'should reject non-string contract addresses',
        fc.property(
            fc.anything().filter((x) => typeof x !== 'string'),
            (input) => {
                const result = validator.validateFormat(input);
                expect(result.valid).toBe(false);
                expect(result.error).toBeDefined();
            },
        ),
    );
});

// ── Negative-case properties: Malformed WASM inputs always produce typed errors ──

describe('SorobanContractValidator — Negative-Case Properties', () => {
    const validator = new SorobanContractValidator();

    // ── Property: Malformed WASM always produces a typed error ──
    it(
        'should produce typed errors for all malformed inputs',
        fc.property(fc.anything(), (input) => {
            const result = validator.validateFormat(input);
            if (!result.valid) {
                expect(result.error).toBeDefined();
                expect(typeof result.error?.code).toBe('string');
                expect(typeof result.error?.reason).toBe('string');
                expect(result.error?.guidance).toBeDefined();
                // Ensure no untyped 'any' error catches
                expect(result.error?.code.length).toBeGreaterThan(0);
            }
        }),
    );

    // ── Property: RPC errors always include error details ──
    it(
        'should include error details for all RPC failures',
        fc.property(async (fc) => {
            const mockFetch = async () => ({
                ok: true,
                json: async () => ({
                    error: {
                        code: fc.integer({ min: -32700, max: -32000 }),
                        message: fc.string(),
                    },
                }),
            });
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            const result = await validatorWithMock.checkExistence(
                'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'https://soroban-testnet.stellar.org',
            );
            if (!result.exists) {
                expect(result.error || !result.callable).toBeTruthy();
            }
        }),
    );

    // ── Property: Network errors always produce a result (never throw) ──
    it(
        'should never throw on network errors',
        fc.property(arbNetworkError(), async (error) => {
            const mockFetch = async () => {
                throw error;
            };
            const validatorWithMock = new SorobanContractValidator(mockFetch as any);
            await expect(
                validatorWithMock.checkExistence(
                    'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                    'https://soroban-testnet.stellar.org',
                ),
            ).resolves.toBeDefined();
        }),
    );
});

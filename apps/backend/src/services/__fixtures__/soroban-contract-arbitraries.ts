/**
 * Soroban Contract Arbitrary Generators for Property-Based Testing
 *
 * Provides fast-check Arbitrary generators for Soroban contract types,
 * enabling property-based fuzz testing of the contract validator service.
 *
 * Issue: #538
 */

import { fc } from '@fast-check/vitest';

/**
 * Generate valid Soroban contract addresses.
 * Format: 56-character base32 string starting with 'C'.
 */
export const arbValidContractAddress = (): fc.Arbitrary<string> => {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    return fc
        .tuple(
            fc.constant('C'),
            fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 55, maxLength: 55 }),
        )
        .map(([prefix, indices]) => prefix + indices.map((i) => base32Chars[i]).join(''));
};

/**
 * Generate invalid contract addresses (wrong length, wrong prefix, invalid chars).
 */
export const arbInvalidContractAddress = (): fc.Arbitrary<string> => {
    return fc.oneof(
        // Wrong prefix
        fc.tuple(
            fc.constantFrom('A', 'B', 'D', 'G', 'Z'),
            fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 55, maxLength: 55 }),
        ).map(([prefix, indices]) => {
            const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
            return prefix + indices.map((i) => base32Chars[i]).join('');
        }),
        // Wrong length
        fc.stringOf(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'), {
            minLength: 1,
            maxLength: 55,
        }),
        // Invalid characters
        fc.tuple(
            fc.constant('C'),
            fc.stringOf(fc.constantFrom('0', '1', '8', '9', '!', '@', '#'), { minLength: 55, maxLength: 55 }),
        ).map(([prefix, suffix]) => prefix + suffix),
        // Empty string
        fc.constant(''),
    );
};

/**
 * Generate arbitrary RPC URLs (valid and invalid formats).
 */
export const arbRpcUrl = (): fc.Arbitrary<string> => {
    return fc.oneof(
        // Valid HTTPS URLs
        fc.tuple(
            fc.constant('https://'),
            fc.domain(),
            fc.constant('/'),
            fc.stringOf(fc.alphaNumericChar(), { minLength: 0, maxLength: 10 }),
        ).map(([proto, domain, slash, path]) => proto + domain + slash + path),
        // Valid HTTP URLs
        fc.tuple(
            fc.constant('http://'),
            fc.domain(),
        ).map(([proto, domain]) => proto + domain),
        // Invalid URLs
        fc.oneof(
            fc.constant('not-a-url'),
            fc.constant('ftp://invalid.com'),
            fc.constant(''),
        ),
    );
};

/**
 * Generate arbitrary JSON-RPC responses from Soroban RPC.
 */
export const arbSorobanRpcResponse = (): fc.Arbitrary<Record<string, unknown>> => {
    return fc.oneof(
        // Success response with entries
        fc.object({
            result: fc.object({
                entries: fc.array(
                    fc.object({ xdr: fc.base64() }),
                    { minLength: 1, maxLength: 5 },
                ),
            }),
        }),
        // Success response with empty entries
        fc.object({
            result: fc.object({
                entries: fc.constant([]),
            }),
        }),
        // Error response
        fc.object({
            error: fc.object({
                code: fc.integer({ min: -32700, max: -32000 }),
                message: fc.string(),
            }),
        }),
        // Malformed response
        fc.object({}),
    );
};

/**
 * Generate arbitrary HTTP status codes.
 */
export const arbHttpStatusCode = (): fc.Arbitrary<number> => {
    return fc.oneof(
        fc.constantFrom(200, 201, 204),
        fc.constantFrom(400, 401, 403, 404),
        fc.constantFrom(500, 502, 503, 504),
        fc.integer({ min: 100, max: 599 }),
    );
};

/**
 * Generate arbitrary network errors.
 */
export const arbNetworkError = (): fc.Arbitrary<Error> => {
    return fc.oneof(
        fc.constant(new Error('ECONNREFUSED')),
        fc.constant(new Error('ETIMEDOUT')),
        fc.constant(new Error('ENOTFOUND')),
        fc.constant(new Error('Network error')),
        fc.string().map((msg) => new Error(msg)),
    );
};

/**
 * Generate arbitrary contract invocation arguments (for future expansion).
 */
export const arbContractArg = (): fc.Arbitrary<unknown> => {
    return fc.oneof(
        fc.integer(),
        fc.string(),
        fc.boolean(),
        fc.array(fc.integer(), { maxLength: 10 }),
        fc.object({
            key: fc.string(),
            value: fc.oneof(fc.integer(), fc.string(), fc.boolean()),
        }),
    );
};

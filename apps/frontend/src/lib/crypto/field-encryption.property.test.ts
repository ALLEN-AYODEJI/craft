/**
 * Property tests for lib/crypto/field-encryption (#231)
 *
 * Property 43 — Sensitive data is never stored as plaintext.
 *
 * Runs 100 iterations over generated sensitive payloads (tokens, API keys,
 * Stripe IDs) and asserts that:
 *   1. The stored value is not equal to the plaintext.
 *   2. The stored value does not contain the plaintext as a substring.
 *   3. The stored value does not contain the base64 encoding of the plaintext.
 *   4. The stored value matches the encrypted-blob format (v<n>.<iv>.<ct>.<tag>).
 *   5. The plaintext is fully recoverable via decrypt().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { encrypt, decrypt, isEncrypted } from './field-encryption';

const VALID_KEY = 'a'.repeat(64); // 32 bytes of 0xaa

// ── Arbitraries for realistic sensitive payloads ──────────────────────────────

/** Stripe customer ID: cus_<20 alphanumeric chars> */
const stripeCustomerId = fc
    .stringMatching(/^[A-Za-z0-9]{20}$/)
    .map((s) => `cus_${s}`);

/** Stripe subscription ID: sub_<20 alphanumeric chars> */
const stripeSubscriptionId = fc
    .stringMatching(/^[A-Za-z0-9]{20}$/)
    .map((s) => `sub_${s}`);

/** Generic API key / token: 32–64 hex characters */
const hexToken = fc.stringMatching(/^[0-9a-f]{32,64}$/);

/** GitHub personal access token: ghp_<36 alphanumeric chars> */
const githubToken = fc
    .stringMatching(/^[A-Za-z0-9]{36}$/)
    .map((s) => `ghp_${s}`);

/** Union of all sensitive payload types */
const sensitivePayload = fc.oneof(
    stripeCustomerId,
    stripeSubscriptionId,
    hexToken,
    githubToken,
);

// ── Property 43 ───────────────────────────────────────────────────────────────

/**
 * Property 43 — Sensitive data is encrypted when stored in the database.
 *
 * For every generated sensitive payload:
 *   - The stored blob must NOT equal the plaintext.
 *   - The stored blob must NOT contain the plaintext as a substring.
 *   - The stored blob must NOT contain the base64 encoding of the plaintext.
 *   - The stored blob must match the encrypted-blob format.
 *   - Decrypting the stored blob must return the original plaintext.
 */
describe('Property 43 — sensitive data is encrypted at rest', () => {
    beforeEach(() => {
        process.env.FIELD_ENCRYPTION_KEY = VALID_KEY;
    });

    afterEach(() => {
        delete process.env.FIELD_ENCRYPTION_KEY;
    });

    it('stored value is never equal to the plaintext (100 iterations)', () => {
        fc.assert(
            fc.property(sensitivePayload, (plaintext) => {
                const stored = encrypt(plaintext);
                expect(stored).not.toBe(plaintext);
            }),
            { numRuns: 100 },
        );
    });

    it('stored value does not contain the plaintext as a substring (100 iterations)', () => {
        fc.assert(
            fc.property(sensitivePayload, (plaintext) => {
                const stored = encrypt(plaintext);
                expect(stored).not.toContain(plaintext);
            }),
            { numRuns: 100 },
        );
    });

    it('stored value does not contain the base64 encoding of the plaintext (100 iterations)', () => {
        fc.assert(
            fc.property(sensitivePayload, (plaintext) => {
                const stored = encrypt(plaintext);
                const b64 = Buffer.from(plaintext).toString('base64');
                const b64url = Buffer.from(plaintext).toString('base64url');
                expect(stored).not.toContain(b64);
                expect(stored).not.toContain(b64url);
            }),
            { numRuns: 100 },
        );
    });

    it('stored value matches the encrypted-blob format (100 iterations)', () => {
        fc.assert(
            fc.property(sensitivePayload, (plaintext) => {
                const stored = encrypt(plaintext);
                // Must be: v<n>.<iv_b64url>.<ct_b64url>.<tag_b64url>
                expect(stored).toMatch(/^v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/);
                expect(stored.split('.')).toHaveLength(4);
                expect(isEncrypted(stored)).toBe(true);
            }),
            { numRuns: 100 },
        );
    });

    it('plaintext is fully recoverable from the stored value (100 iterations)', () => {
        fc.assert(
            fc.property(sensitivePayload, (plaintext) => {
                const stored = encrypt(plaintext);
                expect(decrypt(stored)).toBe(plaintext);
            }),
            { numRuns: 100 },
        );
    });

    it('two encryptions of the same plaintext produce different stored values (100 iterations)', () => {
        fc.assert(
            fc.property(sensitivePayload, (plaintext) => {
                const a = encrypt(plaintext);
                const b = encrypt(plaintext);
                // Random IV guarantees ciphertext uniqueness.
                expect(a).not.toBe(b);
                // Both must still decrypt correctly.
                expect(decrypt(a)).toBe(plaintext);
                expect(decrypt(b)).toBe(plaintext);
            }),
            { numRuns: 100 },
        );
    });
});

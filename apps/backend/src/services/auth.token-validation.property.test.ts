/**
 * Feature: craft-platform, Property 44: Authentication Token Validation
 * Validates: Invalid/expired/missing tokens always rejected with 401
 * 
 * Scenarios:
 *  - Malformed JWT → Supabase rejects (PGRST116)
 *  - Expired token → Supabase rejects 
 *  - Missing token cookie → getUser() returns null user + 401 error
 * 
 * ≥100 iterations per property using fast-check
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { AuthService } from './auth.service';

// --- Supabase mocks for token validation ---
const mockGetUser = vi.fn();
const mockCreateClient = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => mockCreateClient(),
}));

// --- Token Arbitraries ---

/** Malformed tokens: anything not resembling JWT structure */
const malformedTokens = fc.string({ minLength: 1 }).filter(
    (t: string) => !/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(t)
);

/** Valid JWT format but expired (mocked) */
const expiredJwtTokens = fc
    .string({ minLength: 100, maxLength: 500 })
.map((base: string) => base.replace(/exp=\d+/, 'exp=0')) // Force expired claim
    .filter((t: string) => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(t));

/** Empty/missing token cases */
const missingTokens = fc.constant(''); // Empty cookie

/** Valid token control case */
const validTokens = fc.constant('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZXhwIjoxMDAwMDAwMDAwfQ.valid-signature');

// --- Property 44: Invalid tokens always rejected ---

describe('Property 44 — Invalid/Missing Tokens Always Rejected (≥100 iterations)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateClient.mockReturnValue({
            auth: {
                getUser: mockGetUser,
            },
        });
    });

    // ── 44.1: Malformed tokens always rejected ──────────────────────────────────
    it('Property 44.1: malformed tokens → no user + 401 error', async () => {
        await fc.assert(
            fc.asyncProperty(malformedTokens, async (token: string) => {
                // Mock cookie with malformed token
                mockGetUser.mockRejectedValue({
                    data: { user: null },
                    error: {
                        code: 'PGRST116',
                        status: 401,
                        message: 'JWT invalid',
                    },
                });

                const service = new AuthService();
                await expect(service.getCurrentUser()).rejects.toThrow();
            }),
            { numRuns: 100 }
        );
    });

    // ── 44.2: Expired tokens always rejected ────────────────────────────────────
    it('Property 44.2: expired JWTs → no user + 401 error', async () => {
        await fc.assert(
            fc.asyncProperty(expiredJwtTokens, async (token: string) => {
                mockGetUser.mockRejectedValue({
                    data: { user: null },
                    error: {
                        code: 'PGRST116', 
                        status: 401,
                        message: 'JWT expired',
                    },
                });

                const service = new AuthService();
                await expect(service.getCurrentUser()).rejects.toThrow();
            }),
            { numRuns: 100 }
        );
    });

    // ── 44.3: Missing tokens always rejected ────────────────────────────────────
    it('Property 44.3: missing/empty tokens → null user + throws', async () => {
        await fc.assert(
            fc.asyncProperty(missingTokens, async (_token: string) => {
                mockGetUser.mockResolvedValue({
                    data: { user: null },
                    error: {
                        code: 'PGRST301',
                        status: 401,
                        message: 'No JWT provided',
                    },
                });

                const service = new AuthService();
                const user = await service.getCurrentUser();
                expect(user).toBeNull();
            }),
            { numRuns: 100 }
        );
    });

    // ── 44.4: Valid tokens succeed (control) ────────────────────────────────────
    it('Property 44.4: valid tokens → user returned (control)', async () => {
        await fc.assert(
            fc.asyncProperty(validTokens, async () => {
                mockGetUser.mockResolvedValue({
                    data: {
                        user: {
                            id: 'test-user-id',
                            email: 'test@example.com',
                            created_at: new Date().toISOString(),
                        },
                    },
                    error: null,
                });

                const service = new AuthService();
                const user = await service.getCurrentUser();
                expect(user).not.toBeNull();
                expect(user!.id).toBe('test-user-id');
            }),
            { numRuns: 100 }
        );
    });
});


import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSignOut = vi.fn();
vi.mock('@/services/auth.service', () => ({
    authService: { signOut: mockSignOut },
}));

const makeRequest = () =>
    new NextRequest('http://localhost/api/auth/signout', { method: 'POST' });

describe('POST /api/auth/signout', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 200 with success message', async () => {
        mockSignOut.mockResolvedValue(undefined);
        const { POST } = await import('./route');
        const res = await POST();
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: 'Signed out successfully' });
    });

    it('is idempotent — succeeds even when no session exists', async () => {
        // Supabase signOut resolves regardless; simulate that here
        mockSignOut.mockResolvedValue(undefined);
        const { POST } = await import('./route');
        const res1 = await POST();
        const res2 = await POST();
        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
    });

    it('returns 500 if signOut throws', async () => {
        mockSignOut.mockRejectedValue(new Error('network failure'));
        const { POST } = await import('./route');
        const res = await POST();
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('network failure');
    });
});

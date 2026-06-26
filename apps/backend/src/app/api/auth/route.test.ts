import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Supabase server mock (required by withAuth) ---
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: vi.fn(),
    }),
}));

const fakeUser = { id: 'user-1', email: 'a@b.com' };
const fakeProfile = {
    id: 'user-1',
    email: 'a@b.com',
    createdAt: new Date('2024-01-01'),
    subscriptionTier: 'pro',
    githubConnected: false,
};

// --- GET /api/auth/user ---
const mockGetCurrentUser = vi.fn();
vi.mock('@/services/auth.service', () => ({
    authService: { getCurrentUser: mockGetCurrentUser, updateProfile: vi.fn() },
}));

describe('GET /api/auth/user', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./user/route');
        const res = await GET(new NextRequest('http://localhost/api/auth/user'), { params: {} });
        expect(res.status).toBe(401);
    });

    it('returns 404 when user not found in service', async () => {
        mockGetCurrentUser.mockResolvedValue(null);
        const { GET } = await import('./user/route');
        const res = await GET(new NextRequest('http://localhost/api/auth/user'), { params: {} });
        expect(res.status).toBe(404);
    });

    it('returns the current user', async () => {
        mockGetCurrentUser.mockResolvedValue(fakeProfile);
        const { GET } = await import('./user/route');
        const res = await GET(new NextRequest('http://localhost/api/auth/user'), { params: {} });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe('user-1');
        expect(body.subscriptionTier).toBe('pro');
    });
});

// --- PATCH /api/auth/profile ---
describe('PATCH /api/auth/profile', () => {
    const mockUpdateProfile = vi.fn();

    beforeEach(async () => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
        const { authService } = await import('@/services/auth.service');
        (authService.updateProfile as any) = mockUpdateProfile;
    });

    const makeRequest = (body: unknown) =>
        new NextRequest('http://localhost/api/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { PATCH } = await import('./profile/route');
        const res = await PATCH(makeRequest({ fullName: 'Jane' }), { params: {} });
        expect(res.status).toBe(401);
    });

    it('returns 400 for invalid input', async () => {
        const { PATCH } = await import('./profile/route');
        const res = await PATCH(makeRequest({ email: 'not-an-email' }), { params: {} });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.details).toBeDefined();
    });

    it('returns 400 for unknown fields (strict schema)', async () => {
        const { PATCH } = await import('./profile/route');
        const res = await PATCH(makeRequest({ unknownField: 'x' }), { params: {} });
        expect(res.status).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
        const { PATCH } = await import('./profile/route');
        const res = await PATCH(makeRequest({}), { params: {} });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('No fields to update');
    });

    it('returns updated user on valid patch', async () => {
        mockUpdateProfile.mockResolvedValue({ ...fakeProfile, email: 'new@b.com' });
        const { PATCH } = await import('./profile/route');
        const res = await PATCH(makeRequest({ email: 'new@b.com' }), { params: {} });
        expect(res.status).toBe(200);
        expect((await res.json()).email).toBe('new@b.com');
    });
});

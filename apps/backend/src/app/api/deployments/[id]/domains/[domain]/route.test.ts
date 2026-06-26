import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRemoveDomain = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

vi.mock('@/services/vercel.service', () => ({
    VercelService: vi.fn().mockImplementation(() => ({
        removeDomain: mockRemoveDomain,
    })),
    VercelApiError: class VercelApiError extends Error {
        constructor(message: string, public code: string) {
            super(message);
        }
    },
}));

const fakeUser = { id: 'user-1' };
const params = { id: 'dep-1', domain: 'example.com' };

function makeRequest() {
    return new NextRequest(
        'http://localhost/api/deployments/dep-1/domains/example.com',
        { method: 'DELETE' },
    );
}

type QueryResult = { data: Record<string, unknown> | null; error: { message: string } | null };

function makeSupabaseQuery(results: QueryResult[], withUpdate = false) {
    const chain: Record<string, unknown> = {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(results.shift() ?? { data: null, error: null }),
            })),
        })),
    };
    if (withUpdate) {
        chain.update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    }
    return chain;
}

describe('DELETE /api/deployments/[id]/domains/[domain]', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { DELETE } = await import('./route');
        expect((await DELETE(makeRequest(), { params })).status).toBe(401);
    });

    it('returns 403 when deployment belongs to another user', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: 'other' }, error: null }]),
        );
        const { DELETE } = await import('./route');
        expect((await DELETE(makeRequest(), { params })).status).toBe(403);
    });

    it('returns 404 when deployment is not found', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: null, error: { message: 'not found' } }]));
        const { DELETE } = await import('./route');
        expect((await DELETE(makeRequest(), { params })).status).toBe(404);
    });

    it('returns 404 when no Vercel project is configured', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { vercel_project_id: null, custom_domain: null }, error: null }]));
        const { DELETE } = await import('./route');
        const res = await DELETE(makeRequest(), { params });
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatch(/no vercel project/i);
    });

    it('returns 200 and clears custom_domain when it matches', async () => {
        const mockUpdate = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({
                            data: { vercel_project_id: 'prj_1', custom_domain: 'example.com' },
                            error: null,
                        }),
                    })),
                })),
            })
            .mockReturnValueOnce({ update: mockUpdate });
        mockRemoveDomain.mockResolvedValue(undefined);

        const { DELETE } = await import('./route');
        const res = await DELETE(makeRequest(), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.deleted).toBe(true);
        expect(body.domain).toBe('example.com');
        expect(mockUpdate).toHaveBeenCalledWith({ custom_domain: null });
    });

    it('returns 200 and does not clear custom_domain when it differs', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({
                            data: { vercel_project_id: 'prj_1', custom_domain: 'other.com' },
                            error: null,
                        }),
                    })),
                })),
            });
        mockRemoveDomain.mockResolvedValue(undefined);

        const { DELETE } = await import('./route');
        const res = await DELETE(makeRequest(), { params });
        expect(res.status).toBe(200);
    });

    it('returns 500 when removeDomain throws unexpectedly', async () => {
        mockFrom
            .mockReturnValueOnce(makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]))
            .mockReturnValueOnce({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({
                            data: { vercel_project_id: 'prj_1', custom_domain: null },
                            error: null,
                        }),
                    })),
                })),
            });
        mockRemoveDomain.mockRejectedValue(new Error('Vercel API error'));

        const { DELETE } = await import('./route');
        expect((await DELETE(makeRequest(), { params })).status).toBe(500);
    });
});

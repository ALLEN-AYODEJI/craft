import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSignUp = vi.fn();
const mockSignIn = vi.fn();
vi.mock('@/services/auth.service', () => ({
    authService: { signUp: mockSignUp, signIn: mockSignIn },
}));

const fakeUser = { id: 'u1', email: 'a@b.com', subscriptionTier: 'free', githubConnected: false, createdAt: new Date() };
const fakeSession = { accessToken: 'tok', refreshToken: 'ref', expiresAt: new Date() };
const successResult = { user: fakeUser, session: fakeSession, error: null };

const post = (url: string, body: unknown) =>
    new NextRequest(`http://localhost${url}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });

// ── signup ────────────────────────────────────────────────────────────────────
describe('POST /api/auth/signup', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 400 for invalid input', async () => {
        const { POST } = await import('./signup/route');
        const res = await POST(post('/api/auth/signup', { email: 'bad', password: '123' }));
        expect(res.status).toBe(400);
        expect((await res.json()).details).toBeDefined();
    });

    it('returns 400 when service returns an error', async () => {
        mockSignUp.mockResolvedValue({ user: null, session: null, error: { code: 'SIGNUP_ERROR', message: 'Email taken' } });
        const { POST } = await import('./signup/route');
        const res = await POST(post('/api/auth/signup', { email: 'a@b.com', password: 'password123' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Email taken');
    });

    it('returns 409 on profile creation error', async () => {
        mockSignUp.mockResolvedValue({ user: null, session: null, error: { code: 'PROFILE_CREATION_ERROR', message: 'duplicate key' } });
        const { POST } = await import('./signup/route');
        const res = await POST(post('/api/auth/signup', { email: 'a@b.com', password: 'password123' }));
        expect(res.status).toBe(409);
    });

    it('returns 201 with user and session on success', async () => {
        mockSignUp.mockResolvedValue(successResult);
        const { POST } = await import('./signup/route');
        const res = await POST(post('/api/auth/signup', { email: 'a@b.com', password: 'password123' }));
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.user.id).toBe('u1');
        expect(body.session.accessToken).toBe('tok');
    });
});

// ── signin ────────────────────────────────────────────────────────────────────
describe('POST /api/auth/signin', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 400 for invalid input', async () => {
        const { POST } = await import('./signin/route');
        const res = await POST(post('/api/auth/signin', { email: 'bad' }));
        expect(res.status).toBe(400);
    });

    it('returns 401 for invalid credentials', async () => {
        mockSignIn.mockResolvedValue({ user: null, session: null, error: { code: 'SIGNIN_ERROR', message: 'Invalid email or password.' } });
        const { POST } = await import('./signin/route');
        const res = await POST(post('/api/auth/signin', { email: 'a@b.com', password: 'wrong' }));
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe('Invalid email or password.');
    });

    it('returns 200 with user and session on success', async () => {
        mockSignIn.mockResolvedValue(successResult);
        const { POST } = await import('./signin/route');
        const res = await POST(post('/api/auth/signin', { email: 'a@b.com', password: 'correct' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.user.id).toBe('u1');
        expect(body.session.accessToken).toBe('tok');
    });
});

import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withVersion } from './with-version';

describe('withVersion middleware', () => {
    it('should attach apiVersion to request from path', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
        const middleware = withVersion(handler);

        const req = new NextRequest('http://localhost/api/v2/users');
        const response = await middleware(req, {});

        expect(handler).toHaveBeenCalled();
        const calledReq = handler.mock.calls[0][0];
        expect(calledReq.apiVersion).toBe(2);
    });

    it('should negotiate version from Accept header', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
        const middleware = withVersion(handler);

        const req = new NextRequest('http://localhost/api/users', {
            headers: {
                accept: 'application/vnd.craft.v2+json',
            },
        });
        const response = await middleware(req, {});

        const calledReq = handler.mock.calls[0][0];
        expect(calledReq.apiVersion).toBe(2);
    });

    it('should add api-version header to response', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
        const middleware = withVersion(handler);

        const req = new NextRequest('http://localhost/api/users');
        const response = await middleware(req, {});

        expect(response.headers.get('api-version')).toBe('1');
    });

    it('should return 400 for unsupported versions', async () => {
        const handler = vi.fn();
        const middleware = withVersion(handler);

        const req = new NextRequest('http://localhost/api/v999/users');
        const response = await middleware(req, {});

        expect(response.status).toBe(400);
        expect(handler).not.toHaveBeenCalled();
    });

    it('should default to version 1 when no version specified', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
        const middleware = withVersion(handler);

        const req = new NextRequest('http://localhost/api/users');
        const response = await middleware(req, {});

        const calledReq = handler.mock.calls[0][0];
        expect(calledReq.apiVersion).toBe(1);
    });

    it('should handle handler errors gracefully', async () => {
        const error = new Error('Handler error');
        const handler = vi.fn().mockRejectedValue(error);
        const middleware = withVersion(handler);

        const req = new NextRequest('http://localhost/api/users');
        const response = await middleware(req, {});

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(body.error).toBeDefined();
    });

    it('should prioritize path version over header', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ success: true }));
        const middleware = withVersion(handler);

        const req = new NextRequest('http://localhost/api/v2/users', {
            headers: {
                accept: 'application/vnd.craft.v1+json',
            },
        });
        const response = await middleware(req, {});

        const calledReq = handler.mock.calls[0][0];
        expect(calledReq.apiVersion).toBe(2);
    });
});

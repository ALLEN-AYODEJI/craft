/**
 * Middleware to handle API version negotiation and deprecation headers.
 * Wraps route handlers to automatically manage versioning concerns.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    negotiateVersion,
    getDeprecationHeaders,
    isVersionSupported,
    type APIVersion,
} from './version-negotiation';

export interface VersionedRequest extends NextRequest {
    apiVersion: APIVersion;
}

export interface VersionedHandler {
    (req: VersionedRequest, ctx: any): Promise<NextResponse>;
}

/**
 * Higher-order function to add versioning support to route handlers.
 *
 * Usage:
 *   export const GET = withVersion(async (req, ctx) => {
 *     const apiVersion = req.apiVersion;
 *     // Handle request based on apiVersion
 *   });
 */
export function withVersion(handler: VersionedHandler) {
    return async (req: NextRequest, ctx: any) => {
        try {
            // Negotiate version from path, header, query, or default
            const { version, source } = negotiateVersion(
                req.nextUrl.pathname,
                req.headers.get('accept') || undefined,
                req.nextUrl.searchParams.get('api-version') || undefined,
            );

            // Check if version is supported
            if (!isVersionSupported(version)) {
                return NextResponse.json(
                    { error: `API version ${version} is not supported` },
                    { status: 400 },
                );
            }

            // Attach version to request
            const versionedReq = req as VersionedRequest;
            versionedReq.apiVersion = version;

            // Call handler
            const response = await handler(versionedReq, ctx);

            // Add deprecation headers if version is deprecated
            const depHeaders = getDeprecationHeaders(version);
            Object.entries(depHeaders).forEach(([key, value]) => {
                if (value !== undefined) {
                    response.headers.set(key, value as string);
                }
            });

            return response;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Versioning error';
            console.error('[version-negotiation] error:', err);
            return NextResponse.json({ error: msg }, { status: 500 });
        }
    };
}

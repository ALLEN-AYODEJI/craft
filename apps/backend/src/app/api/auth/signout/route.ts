import { NextResponse } from 'next/server';
import { authService } from '@/services/auth.service';

/**
 * POST /api/auth/signout
 *
 * Invalidates the current Supabase session by clearing the auth cookie.
 * Idempotent — returns 200 even if no active session exists.
 *
 * After a successful response the client should redirect to the sign-in page.
 */
export async function POST() {
    try {
        await authService.signOut();
        return NextResponse.json({ message: 'Signed out successfully' });
    } catch (error: any) {
        console.error('Error signing out:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to sign out' },
            { status: 500 }
        );
    }
}

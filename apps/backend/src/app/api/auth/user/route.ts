import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { authService } from '@/services/auth.service';

export const GET = withAuth(async (_req: NextRequest, { user }) => {
    try {
        const currentUser = await authService.getCurrentUser();
        if (!currentUser) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }
        return NextResponse.json(currentUser);
    } catch (error: any) {
        console.error('Error fetching current user:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch user' },
            { status: 500 }
        );
    }
});

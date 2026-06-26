import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { paymentService } from '@/services/payment.service';

export const GET = withAuth(async (_req: NextRequest, { user }) => {
    try {
        const status = await paymentService.getSubscriptionStatus(user.id);
        return NextResponse.json(status);
    } catch (error: any) {
        console.error('Error getting subscription status:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to get subscription status' },
            { status: 500 }
        );
    }
});

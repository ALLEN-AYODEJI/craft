import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { paymentService } from '@/services/payment.service';

export const POST = withAuth(async (_req: NextRequest, { user, supabase }) => {
    const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_subscription_id')
        .eq('id', user.id)
        .single();

    if (!profile?.stripe_subscription_id) {
        return NextResponse.json({ error: 'No active subscription found' }, { status: 404 });
    }

    try {
        await paymentService.cancelSubscription(profile.stripe_subscription_id);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error canceling subscription:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to cancel subscription' },
            { status: 500 }
        );
    }
});

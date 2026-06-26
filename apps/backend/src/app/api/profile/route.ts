import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth, type AuthedRouteContext } from '@/lib/api/with-auth';

const profileSchema = z.object({
    displayName: z.string().trim().min(2, 'Display name must be at least 2 characters.'),
    bio: z.string().max(160, 'Bio must be 160 characters or fewer.').optional().default(''),
    avatarUrl: z.string().url('Avatar URL must be a valid URL.').optional().or(z.literal('')),
    email: z.string().email('Email must be a valid email address.').optional(),
});

function normalizeAvatarUrl(avatarUrl?: string) {
    return avatarUrl && avatarUrl.length > 0 ? avatarUrl : undefined;
}

export const GET = withAuth(async (_req: NextRequest, { user, supabase }) => {
    const { data: refreshedUser } = await supabase.auth.getUser();
    const currentUser = refreshedUser.user ?? user;
    const metadata = currentUser.user_metadata ?? {};

    return NextResponse.json({
        displayName: metadata.full_name ?? currentUser.email ?? '',
        email: currentUser.email ?? '',
        bio: metadata.bio ?? '',
        avatarUrl: metadata.avatar_url ?? '',
    });
});

async function updateProfile(req: NextRequest, { user, supabase }: AuthedRouteContext) {
    const body = await req.json();
    const parsed = profileSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    const { displayName, bio, avatarUrl, email } = parsed.data;

    const updates = {
        full_name: displayName,
        avatar_url: normalizeAvatarUrl(avatarUrl),
        bio,
    };

    const { error: metadataError } = await supabase.auth.updateUser({
        email,
        data: updates,
    });

    if (metadataError) {
        return NextResponse.json(
            { error: metadataError.message || 'Failed to update profile' },
            { status: 500 }
        );
    }

    const { data: refreshedUser } = await supabase.auth.getUser();
    const currentUser = refreshedUser.user ?? user;
    const metadata = currentUser.user_metadata ?? {};

    return NextResponse.json({
        displayName: metadata.full_name ?? displayName,
        email: currentUser.email ?? email ?? '',
        bio: metadata.bio ?? bio ?? '',
        avatarUrl: metadata.avatar_url ?? avatarUrl ?? '',
    });
}

export const PUT = withAuth(updateProfile);
export const PATCH = withAuth(updateProfile);

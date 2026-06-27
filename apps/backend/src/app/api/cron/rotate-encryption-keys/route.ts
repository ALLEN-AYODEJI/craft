import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withCronAuth } from '../../../../lib/api/cron-auth';
import { rotateProfileEncryptedColumns } from '../../../../lib/crypto/key-rotation';
import { KEY_VERSION } from '../../../../lib/crypto/field-encryption';

const currentEncryptionKeyName = KEY_VERSION === 1
  ? 'FIELD_ENCRYPTION_KEY'
  : `FIELD_ENCRYPTION_KEY_${KEY_VERSION}`;

async function handleRotateEncryptionKeys(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const currentEncryptionKey = process.env[currentEncryptionKeyName];

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error:
          'Missing Supabase service role configuration. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      },
      { status: 500 },
    );
  }

  if (!currentEncryptionKey || currentEncryptionKey.length !== 64) {
    return NextResponse.json(
      {
        error: `${currentEncryptionKeyName} must be set to a 64-character hex key before rotating encrypted profile fields.`,
      },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const summary = await rotateProfileEncryptedColumns(supabase);
    return NextResponse.json({ rotated: summary });
  } catch (error: any) {
    console.error('Error running rotate-encryption-keys cron:', error);
    return NextResponse.json(
      { error: error.message || 'Rotation failed' },
      { status: 500 },
    );
  }
}

/**
 * Cron: rotate field-level encryption for profile columns.
 *
 * This endpoint re-encrypts profile-level Stripe fields using the current
 * active FIELD_ENCRYPTION_KEY (or FIELD_ENCRYPTION_KEY_<N> when KEY_VERSION > 1).
 * It is guarded by CRON_SECRET and intended to run on a weekly schedule.
 */
export const GET = withCronAuth(handleRotateEncryptionKeys);

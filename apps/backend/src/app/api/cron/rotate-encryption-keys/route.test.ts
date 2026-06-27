import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret';
const SUPABASE_URL = 'https://example.supabase.co';
const SERVICE_KEY = 'service-role-key';

vi.mock('../../../../lib/crypto/key-rotation', () => ({
  rotateProfileEncryptedColumns: vi.fn(),
}));

function makeRequest(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  return new NextRequest('http://localhost/api/cron/rotate-encryption-keys', { headers });
}

describe('GET /api/cron/rotate-encryption-keys', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    process.env.FIELD_ENCRYPTION_KEY = 'b'.repeat(64);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY;
    delete process.env.FIELD_ENCRYPTION_KEY_0;
  });

  it('returns 401 when cron secret is invalid', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest('Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: invalid or missing cron signature' });
  });

  it('rotates encrypted profile columns successfully', async () => {
    const { rotateProfileEncryptedColumns } = await import('../../../../lib/crypto/key-rotation');
    vi.mocked(rotateProfileEncryptedColumns).mockResolvedValue({
      stripe_customer_id_encrypted: { total: 1, rotated: 1 },
      stripe_subscription_id_encrypted: { total: 1, rotated: 1 },
    });

    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rotated: {
        stripe_customer_id_encrypted: { total: 1, rotated: 1 },
        stripe_subscription_id_encrypted: { total: 1, rotated: 1 },
      },
    });
    expect(rotateProfileEncryptedColumns).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the required encryption key environment variable is missing', async () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    const { GET } = await import('./route');

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/FIELD_ENCRYPTION_KEY/);
  });

  it('returns 500 when rotation fails partway through', async () => {
    const { rotateProfileEncryptedColumns } = await import('@/lib/crypto/key-rotation');
    vi.mocked(rotateProfileEncryptedColumns).mockRejectedValue(new Error('DB update failed'));

    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('DB update failed');
    expect(rotateProfileEncryptedColumns).toHaveBeenCalledTimes(1);
  });
});

/**
 * Environment Variable Validation Tests — Issue #345
 *
 * Verifies that every env-reading module throws clear errors for missing /
 * malformed variables and behaves correctly with valid ones.
 *
 * Modules under test:
 *   lib/github/config.ts        — GitHub App credentials
 *   lib/stripe/pricing.ts       — Stripe price IDs + SKIP_PRICING_VALIDATION
 *   services/vercel.service.ts  — VERCEL_TOKEN / VERCEL_TEAM_ID
 *   lib/api/cors.ts             — ALLOWED_ORIGINS
 *   lib/api/rate-limit.ts       — RATE_LIMIT_DISABLED
 *   lib/crypto/field-encryption.ts — FIELD_ENCRYPTION_KEY
 *
 * Sensitive variable redaction is verified by asserting that error messages
 * never contain the actual secret value.
 *
 * All tests manipulate process.env in isolation and restore it afterwards.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getGitHubAppConfig, normalizePrivateKey, GitHubAppConfigError } from '../../src/lib/github/config';
import { validatePricingConfig } from '../../src/lib/stripe/pricing';
import { validateVercelConfig, VercelService } from '../../src/services/vercel.service';
import { getAllowedOrigins } from '../../src/lib/api/cors';
import { checkRateLimit, AUTH_RATE_LIMIT, _resetStore } from '../../src/lib/api/rate-limit';
import { encrypt } from '../../src/lib/crypto/field-encryption';

// ── Env isolation helper ──────────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try { fn(); }
    finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_PEM = '-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----';

const VALID_GITHUB_ENV = {
    GITHUB_APP_ID: '12345',
    GITHUB_APP_INSTALLATION_ID: '67890',
    GITHUB_APP_PRIVATE_KEY: VALID_PEM,
};

const VALID_HEX_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

// ── GitHub App config ─────────────────────────────────────────────────────────

describe('GitHub App config — required variables', () => {
    it('parses valid env into typed config', () => {
        const cfg = getGitHubAppConfig(VALID_GITHUB_ENV as NodeJS.ProcessEnv);
        expect(cfg.appId).toBe(12345);
        expect(cfg.installationId).toBe(67890);
        expect(cfg.apiBaseUrl).toBe('https://api.github.com');
    });

    it.each(['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'])(
        'throws CONFIGURATION_ERROR when %s is missing',
        (key) => {
            const env = { ...VALID_GITHUB_ENV, [key]: undefined };
            expect(() => getGitHubAppConfig(env as NodeJS.ProcessEnv))
                .toThrow(GitHubAppConfigError);
        },
    );

    it('throws when GITHUB_APP_ID is not a positive integer', () => {
        const env = { ...VALID_GITHUB_ENV, GITHUB_APP_ID: 'not-a-number' };
        expect(() => getGitHubAppConfig(env as NodeJS.ProcessEnv))
            .toThrow('expected a positive integer');
    });

    it('throws when GITHUB_APP_INSTALLATION_ID is zero', () => {
        const env = { ...VALID_GITHUB_ENV, GITHUB_APP_INSTALLATION_ID: '0' };
        expect(() => getGitHubAppConfig(env as NodeJS.ProcessEnv))
            .toThrow('expected a positive integer');
    });

    it('throws when GITHUB_API_BASE_URL is a relative path', () => {
        const env = { ...VALID_GITHUB_ENV, GITHUB_API_BASE_URL: '/relative' };
        expect(() => getGitHubAppConfig(env as NodeJS.ProcessEnv))
            .toThrow('expected an absolute http(s) URL');
    });

    it('strips trailing slash from GITHUB_API_BASE_URL', () => {
        const env = { ...VALID_GITHUB_ENV, GITHUB_API_BASE_URL: 'https://api.github.com/' };
        expect(getGitHubAppConfig(env as NodeJS.ProcessEnv).apiBaseUrl)
            .toBe('https://api.github.com');
    });

    it('error message for missing var does not contain the secret value', () => {
        const env = { ...VALID_GITHUB_ENV, GITHUB_APP_PRIVATE_KEY: '' };
        let msg = '';
        try { getGitHubAppConfig(env as NodeJS.ProcessEnv); } catch (e) { msg = (e as Error).message; }
        expect(msg).not.toContain(VALID_PEM);
        expect(msg).toContain('GITHUB_APP_PRIVATE_KEY');
    });
});

describe('normalizePrivateKey', () => {
    it('converts escaped \\n to real newlines', () => {
        expect(normalizePrivateKey(VALID_PEM)).toContain('\n');
    });

    it('throws for non-PEM input', () => {
        expect(() => normalizePrivateKey('raw-token-value'))
            .toThrow('expected a PEM encoded private key');
    });

    it('error message does not echo the raw key value', () => {
        const raw = 'raw-token-value';
        let msg = '';
        try { normalizePrivateKey(raw); } catch (e) { msg = (e as Error).message; }
        expect(msg).not.toContain(raw);
    });
});

// ── Stripe pricing config ─────────────────────────────────────────────────────

describe('Stripe pricing config — validatePricingConfig', () => {
    it('passes when both price IDs are set', () => {
        withEnv({
            SKIP_PRICING_VALIDATION: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_PRO: 'price_pro_123',
            NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE: 'price_ent_456',
        }, () => {
            expect(() => validatePricingConfig()).not.toThrow();
        });
    });

    it('throws when NEXT_PUBLIC_STRIPE_PRICE_PRO is missing', () => {
        withEnv({
            SKIP_PRICING_VALIDATION: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_PRO: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE: 'price_ent_456',
        }, () => {
            expect(() => validatePricingConfig()).toThrow('NEXT_PUBLIC_STRIPE_PRICE_PRO');
        });
    });

    it('throws when NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE is missing', () => {
        withEnv({
            SKIP_PRICING_VALIDATION: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_PRO: 'price_pro_123',
            NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE: undefined,
        }, () => {
            expect(() => validatePricingConfig()).toThrow('NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE');
        });
    });

    it('error message lists all missing variables', () => {
        withEnv({
            SKIP_PRICING_VALIDATION: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_PRO: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE: undefined,
        }, () => {
            let msg = '';
            try { validatePricingConfig(); } catch (e) { msg = (e as Error).message; }
            expect(msg).toContain('NEXT_PUBLIC_STRIPE_PRICE_PRO');
            expect(msg).toContain('NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE');
        });
    });

    it('bypasses validation when SKIP_PRICING_VALIDATION=true', () => {
        withEnv({
            SKIP_PRICING_VALIDATION: 'true',
            NEXT_PUBLIC_STRIPE_PRICE_PRO: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE: undefined,
        }, () => {
            expect(() => validatePricingConfig()).not.toThrow();
        });
    });

    it('does NOT bypass when SKIP_PRICING_VALIDATION=false', () => {
        withEnv({
            SKIP_PRICING_VALIDATION: 'false',
            NEXT_PUBLIC_STRIPE_PRICE_PRO: undefined,
            NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE: undefined,
        }, () => {
            expect(() => validatePricingConfig()).toThrow();
        });
    });
});

// ── Vercel config ─────────────────────────────────────────────────────────────

describe('Vercel config — validateVercelConfig', () => {
    it('returns valid:true when VERCEL_TOKEN is set', () => {
        withEnv({ VERCEL_TOKEN: 'tok_abc' }, () => {
            expect(validateVercelConfig()).toEqual({ valid: true });
        });
    });

    it('returns valid:false with missing:VERCEL_TOKEN when unset', () => {
        withEnv({ VERCEL_TOKEN: undefined }, () => {
            expect(validateVercelConfig()).toEqual({ valid: false, missing: 'VERCEL_TOKEN' });
        });
    });

    it('VercelService.buildHeaders throws AUTH_FAILED when VERCEL_TOKEN is absent', () => {
        withEnv({ VERCEL_TOKEN: undefined }, () => {
            const svc = new VercelService();
            // triggerDeployment calls buildHeaders internally
            expect(() => svc['buildHeaders']()).toThrow('VERCEL_TOKEN is not configured');
        });
    });
});

// ── CORS — ALLOWED_ORIGINS ────────────────────────────────────────────────────

describe('CORS — ALLOWED_ORIGINS', () => {
    it('parses comma-separated origins', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app,https://www.craft.app', NODE_ENV: 'production' }, () => {
            const origins = getAllowedOrigins();
            expect(origins.has('https://craft.app')).toBe(true);
            expect(origins.has('https://www.craft.app')).toBe(true);
        });
    });

    it('trims whitespace around each origin', () => {
        withEnv({ ALLOWED_ORIGINS: ' https://craft.app , https://www.craft.app ', NODE_ENV: 'production' }, () => {
            const origins = getAllowedOrigins();
            expect(origins.has('https://craft.app')).toBe(true);
        });
    });

    it('always includes localhost:3000 in non-production', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'development' }, () => {
            expect(getAllowedOrigins().has('http://localhost:3000')).toBe(true);
        });
    });

    it('does not include localhost:3000 in production', () => {
        withEnv({ ALLOWED_ORIGINS: 'https://craft.app', NODE_ENV: 'production' }, () => {
            expect(getAllowedOrigins().has('http://localhost:3000')).toBe(false);
        });
    });

    it('returns only localhost when ALLOWED_ORIGINS is unset in development', () => {
        withEnv({ ALLOWED_ORIGINS: undefined, NODE_ENV: 'development' }, () => {
            const origins = getAllowedOrigins();
            expect(origins.has('http://localhost:3000')).toBe(true);
            expect(origins.size).toBe(1);
        });
    });
});

// ── Rate limiting — RATE_LIMIT_DISABLED ──────────────────────────────────────

describe('Rate limiting — RATE_LIMIT_DISABLED', () => {
    beforeEach(() => _resetStore());
    afterEach(() => _resetStore());

    it('enforces limits when RATE_LIMIT_DISABLED is not set', () => {
        // Exhaust the limit
        for (let i = 0; i < AUTH_RATE_LIMIT.limit; i++) {
            checkRateLimit('test-key', AUTH_RATE_LIMIT);
        }
        const result = checkRateLimit('test-key', AUTH_RATE_LIMIT);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
    });

    it('remaining decrements with each allowed request', () => {
        const first  = checkRateLimit('key-a', AUTH_RATE_LIMIT);
        const second = checkRateLimit('key-a', AUTH_RATE_LIMIT);
        expect(second.remaining).toBe(first.remaining - 1);
    });

    it('different keys are tracked independently', () => {
        for (let i = 0; i < AUTH_RATE_LIMIT.limit; i++) {
            checkRateLimit('key-x', AUTH_RATE_LIMIT);
        }
        // key-y is unaffected
        expect(checkRateLimit('key-y', AUTH_RATE_LIMIT).allowed).toBe(true);
    });
});

// ── Field encryption — FIELD_ENCRYPTION_KEY ──────────────────────────────────

describe('Field encryption — FIELD_ENCRYPTION_KEY', () => {
    it('throws when FIELD_ENCRYPTION_KEY is missing', () => {
        withEnv({ FIELD_ENCRYPTION_KEY: undefined }, () => {
            expect(() => encrypt('secret')).toThrow('FIELD_ENCRYPTION_KEY');
        });
    });

    it('throws when FIELD_ENCRYPTION_KEY is too short', () => {
        withEnv({ FIELD_ENCRYPTION_KEY: 'abc' }, () => {
            expect(() => encrypt('secret')).toThrow('64-character hex string');
        });
    });

    it('throws when FIELD_ENCRYPTION_KEY is too long', () => {
        withEnv({ FIELD_ENCRYPTION_KEY: 'a'.repeat(65) }, () => {
            expect(() => encrypt('secret')).toThrow('64-character hex string');
        });
    });

    it('succeeds with a valid 64-char hex key', () => {
        withEnv({ FIELD_ENCRYPTION_KEY: VALID_HEX_KEY }, () => {
            expect(() => encrypt('my-secret')).not.toThrow();
        });
    });

    it('error message does not contain the key value', () => {
        const badKey = 'tooshort';
        withEnv({ FIELD_ENCRYPTION_KEY: badKey }, () => {
            let msg = '';
            try { encrypt('secret'); } catch (e) { msg = (e as Error).message; }
            expect(msg).not.toContain(badKey);
        });
    });

    it('error message does not contain the plaintext being encrypted', () => {
        withEnv({ FIELD_ENCRYPTION_KEY: undefined }, () => {
            const plaintext = 'super-secret-value';
            let msg = '';
            try { encrypt(plaintext); } catch (e) { msg = (e as Error).message; }
            expect(msg).not.toContain(plaintext);
        });
    });

    it('encrypted output does not contain the plaintext', () => {
        withEnv({ FIELD_ENCRYPTION_KEY: VALID_HEX_KEY }, () => {
            const ciphertext = encrypt('my-secret-value');
            expect(ciphertext).not.toContain('my-secret-value');
        });
    });
});

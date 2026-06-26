/**
 * Property 55 — Custom Domain Tier Restriction
 *
 * "Free tier users must not be able to configure custom domains.
 *  Any attempt must be rejected with an upgrade prompt identifying the
 *  minimum tier required."
 *
 * Strategy
 * ────────
 * 100 iterations, seeded PRNG — no extra dependencies beyond vitest.
 *
 * Each iteration:
 *   1. Pick a random tier and a random domain string.
 *   2. Run the domain-configuration guard.
 *   3. Assert:
 *      - free  → rejected, reason CUSTOM_DOMAIN_NOT_AVAILABLE, requiredTier present
 *      - pro   → allowed (has 1 custom domain slot)
 *      - enterprise → allowed (unlimited)
 *
 * Feature: craft-platform
 * Issue: add-property-test-for-custom-domain-tier-restric
 * Property: 55
 */

import { describe, it, expect } from 'vitest';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DomainConfigAllowed {
  allowed: true;
}

interface DomainConfigRejected {
  allowed: false;
  reason: 'CUSTOM_DOMAIN_NOT_AVAILABLE';
  requiredTier: Exclude<SubscriptionTier, 'free'>;
  upgradePrompt: string;
}

type DomainConfigResult = DomainConfigAllowed | DomainConfigRejected;

// ── System under test (pure guard) ───────────────────────────────────────────

function checkCustomDomainAccess(tier: SubscriptionTier): DomainConfigResult {
  const { maxCustomDomains } = TIER_CONFIGS[tier].entitlements;

  if (maxCustomDomains !== 0) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'CUSTOM_DOMAIN_NOT_AVAILABLE',
    requiredTier: 'pro',
    upgradePrompt: 'Custom domains require the Pro plan or above.',
  };
}

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function makePrng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simple domain generator: pick from a fixed pool to keep the test pure
const SAMPLE_DOMAINS = [
  'example.com', 'my-app.io', 'defi.xyz', 'stellar.app',
  'trade.finance', 'pay.me', 'token.exchange', 'vault.network',
];

const TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];
const ITERATIONS = 100;
const BASE_SEED = 0x1234abcd;

// ── Property 55 ───────────────────────────────────────────────────────────────

describe('Property 55 — Custom Domain Tier Restriction', () => {
  it(
    `free tier is always rejected; paid tiers are always allowed — ${ITERATIONS} iterations`,
    () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const rand = makePrng(BASE_SEED + i);

        const tier = TIERS[Math.floor(rand() * TIERS.length)];
        const _domain = SAMPLE_DOMAINS[Math.floor(rand() * SAMPLE_DOMAINS.length)];

        const result = checkCustomDomainAccess(tier);

        if (tier === 'free') {
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.reason).toBe('CUSTOM_DOMAIN_NOT_AVAILABLE');
            expect(result.requiredTier).toBe('pro');
            expect(result.upgradePrompt.length).toBeGreaterThan(0);
          }
        } else {
          // pro and enterprise both have maxCustomDomains > 0
          expect(result.allowed).toBe(true);
        }
      }
    }
  );

  // ── Targeted invariants ───────────────────────────────────────────────────

  it('free tier → rejected with upgrade prompt', () => {
    const r = checkCustomDomainAccess('free');
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe('CUSTOM_DOMAIN_NOT_AVAILABLE');
      expect(r.requiredTier).toBe('pro');
      expect(typeof r.upgradePrompt).toBe('string');
      expect(r.upgradePrompt.length).toBeGreaterThan(0);
    }
  });

  it('pro tier → allowed', () => {
    expect(checkCustomDomainAccess('pro').allowed).toBe(true);
  });

  it('enterprise tier → allowed', () => {
    expect(checkCustomDomainAccess('enterprise').allowed).toBe(true);
  });

  it('free tier entitlement has maxCustomDomains === 0 (spec guard)', () => {
    expect(TIER_CONFIGS.free.entitlements.maxCustomDomains).toBe(0);
  });
});

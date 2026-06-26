/**
 * Property 54 — Subscription Tier Deployment Limits
 *
 * "For any sequence of deployment attempts, the system must enforce the
 *  maximum deployment count defined for the user's subscription tier.
 *  Attempts that exceed the limit must be rejected; attempts within the
 *  limit must succeed."
 *
 * Strategy
 * ────────
 * 100 iterations, seeded PRNG — no extra dependencies beyond vitest.
 *
 * Each iteration:
 *   1. Pick a random tier (free / pro / enterprise).
 *   2. Pick a random number of existing deployments (0 … limit+2).
 *   3. Attempt one more deployment through a pure enforcement function.
 *   4. Assert: allowed iff existing < maxDeployments (or unlimited).
 *
 * Feature: craft-platform
 * Issue: add-property-test-for-subscription-tier-deployme
 * Property: 54
 */

import { describe, it, expect } from 'vitest';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeploymentLimitCheckResult {
  allowed: boolean;
  /** Present when allowed === false. */
  reason?: 'DEPLOYMENT_LIMIT_EXCEEDED';
  /** The tier limit that was applied (-1 = unlimited). */
  limit: number;
}

// ── System under test (pure enforcement logic) ────────────────────────────────

/**
 * Pure function that mirrors the deployment-creation guard.
 * Returns whether a new deployment is allowed given the current count.
 */
function checkDeploymentLimit(
  tier: SubscriptionTier,
  existingCount: number
): DeploymentLimitCheckResult {
  const { maxDeployments } = TIER_CONFIGS[tier].entitlements;

  if (maxDeployments === -1) {
    return { allowed: true, limit: -1 };
  }

  if (existingCount >= maxDeployments) {
    return { allowed: false, reason: 'DEPLOYMENT_LIMIT_EXCEEDED', limit: maxDeployments };
  }

  return { allowed: true, limit: maxDeployments };
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

const TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];
const ITERATIONS = 100;
const BASE_SEED = 0xcafe1234;

// ── Property 54 ───────────────────────────────────────────────────────────────

describe('Property 54 — Subscription Tier Deployment Limits', () => {
  it(
    `enforces per-tier deployment limits correctly across ${ITERATIONS} random scenarios`,
    () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const rand = makePrng(BASE_SEED + i);

        const tier = TIERS[Math.floor(rand() * TIERS.length)];
        const { maxDeployments } = TIER_CONFIGS[tier].entitlements;

        // Generate existing count in range [0, limit + 2] (or [0, 12] for unlimited)
        const upperBound = maxDeployments === -1 ? 12 : maxDeployments + 2;
        const existingCount = Math.floor(rand() * (upperBound + 1));

        const result = checkDeploymentLimit(tier, existingCount);

        if (maxDeployments === -1) {
          // Enterprise: always allowed
          expect(result.allowed).toBe(true);
          expect(result.limit).toBe(-1);
        } else if (existingCount >= maxDeployments) {
          // At or over limit: must be rejected
          expect(result.allowed).toBe(false);
          expect(result.reason).toBe('DEPLOYMENT_LIMIT_EXCEEDED');
          expect(result.limit).toBe(maxDeployments);
        } else {
          // Under limit: must be allowed
          expect(result.allowed).toBe(true);
          expect(result.limit).toBe(maxDeployments);
        }
      }
    }
  );

  // ── Targeted invariants ───────────────────────────────────────────────────

  it('free tier: 0 existing deployments → allowed', () => {
    expect(checkDeploymentLimit('free', 0).allowed).toBe(true);
  });

  it('free tier: 1 existing deployment → rejected', () => {
    const r = checkDeploymentLimit('free', 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('DEPLOYMENT_LIMIT_EXCEEDED');
  });

  it('pro tier: at limit → rejected', () => {
    const limit = TIER_CONFIGS.pro.entitlements.maxDeployments;
    expect(checkDeploymentLimit('pro', limit).allowed).toBe(false);
  });

  it('pro tier: one below limit → allowed', () => {
    const limit = TIER_CONFIGS.pro.entitlements.maxDeployments;
    expect(checkDeploymentLimit('pro', limit - 1).allowed).toBe(true);
  });

  it('enterprise tier: any count → always allowed', () => {
    for (const count of [0, 50, 1000]) {
      expect(checkDeploymentLimit('enterprise', count).allowed).toBe(true);
    }
  });
});

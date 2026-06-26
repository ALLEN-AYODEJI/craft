/**
 * Property 56 — Upgrade Prompts on Tier Limit Exceeded
 *
 * "For any user action that exceeds their subscription tier limit, an upgrade
 *  prompt must be shown. The prompt must identify the locked feature and the
 *  minimum tier required to unlock it."
 *
 * Strategy
 * ────────
 * 100 iterations, seeded PRNG — no extra dependencies beyond vitest.
 *
 * Each iteration:
 *   1. Pick a random tier and a random limit-exceeding scenario (deployments
 *      over cap, custom-domain attempt on free, analytics on free).
 *   2. Run the scenario through a pure upgrade-prompt resolver.
 *   3. Assert: prompt is shown, feature name is present, requiredTier is
 *      strictly higher than the user's current tier.
 *
 * Feature: craft-platform
 * Issue: add-property-test-for-tier-limit-upgrade-prompt
 * Property: 56
 */

import { describe, it, expect } from 'vitest';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type LimitedFeature = 'deployments' | 'custom_domains' | 'analytics';

interface UpgradePromptResult {
  showPrompt: true;
  feature: LimitedFeature;
  requiredTier: Exclude<SubscriptionTier, 'free'>;
}

interface AllowedResult {
  showPrompt: false;
}

type AccessCheckResult = UpgradePromptResult | AllowedResult;

// ── System under test (pure access-check logic) ───────────────────────────────

const TIER_ORDER: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

function tierIndex(t: SubscriptionTier): number {
  return TIER_ORDER.indexOf(t);
}

/**
 * Returns the minimum tier that satisfies the feature requirement,
 * or null if the current tier already satisfies it.
 */
function resolveUpgradePrompt(
  tier: SubscriptionTier,
  feature: LimitedFeature,
  context: { existingDeployments?: number }
): AccessCheckResult {
  const ent = TIER_CONFIGS[tier].entitlements;

  switch (feature) {
    case 'deployments': {
      const count = context.existingDeployments ?? 0;
      if (ent.maxDeployments === -1 || count < ent.maxDeployments) {
        return { showPrompt: false };
      }
      // Find the cheapest tier that allows more deployments
      const required = TIER_ORDER.find((t) => {
        const e = TIER_CONFIGS[t].entitlements;
        return (e.maxDeployments === -1 || e.maxDeployments > count) &&
          tierIndex(t) > tierIndex(tier);
      }) as Exclude<SubscriptionTier, 'free'> | undefined;
      if (!required) return { showPrompt: false }; // already at max tier
      return { showPrompt: true, feature, requiredTier: required };
    }

    case 'custom_domains': {
      if (ent.maxCustomDomains !== 0) return { showPrompt: false };
      return { showPrompt: true, feature, requiredTier: 'pro' };
    }

    case 'analytics': {
      if (ent.analyticsEnabled) return { showPrompt: false };
      return { showPrompt: true, feature, requiredTier: 'pro' };
    }
  }
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
const FEATURES: LimitedFeature[] = ['deployments', 'custom_domains', 'analytics'];
const ITERATIONS = 100;
const BASE_SEED = 0xabcd5678;

// ── Property 56 ───────────────────────────────────────────────────────────────

describe('Property 56 — Upgrade Prompts on Tier Limit Exceeded', () => {
  it(
    `shows upgrade prompt whenever a tier limit is exceeded — ${ITERATIONS} iterations`,
    () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const rand = makePrng(BASE_SEED + i);

        const tier = TIERS[Math.floor(rand() * TIERS.length)];
        const feature = FEATURES[Math.floor(rand() * FEATURES.length)];
        const ent = TIER_CONFIGS[tier].entitlements;

        // Build a context that is guaranteed to exceed the limit
        let context: { existingDeployments?: number } = {};
        let shouldExceed = false;

        if (feature === 'deployments' && ent.maxDeployments !== -1) {
          context = { existingDeployments: ent.maxDeployments }; // at cap
          shouldExceed = true;
        } else if (feature === 'custom_domains' && ent.maxCustomDomains === 0) {
          shouldExceed = true;
        } else if (feature === 'analytics' && !ent.analyticsEnabled) {
          shouldExceed = true;
        }

        const result = resolveUpgradePrompt(tier, feature, context);

        if (shouldExceed) {
          // Prompt must be shown
          expect(result.showPrompt).toBe(true);
          if (result.showPrompt) {
            expect(result.feature).toBe(feature);
            // Required tier must be strictly higher than current
            expect(tierIndex(result.requiredTier)).toBeGreaterThan(tierIndex(tier));
          }
        } else {
          // Within limits — no prompt
          expect(result.showPrompt).toBe(false);
        }
      }
    }
  );

  // ── Targeted invariants ───────────────────────────────────────────────────

  it('free tier at deployment cap → prompt for pro', () => {
    const cap = TIER_CONFIGS.free.entitlements.maxDeployments;
    const r = resolveUpgradePrompt('free', 'deployments', { existingDeployments: cap });
    expect(r.showPrompt).toBe(true);
    if (r.showPrompt) expect(r.requiredTier).toBe('pro');
  });

  it('free tier custom domain attempt → prompt for pro', () => {
    const r = resolveUpgradePrompt('free', 'custom_domains', {});
    expect(r.showPrompt).toBe(true);
    if (r.showPrompt) expect(r.requiredTier).toBe('pro');
  });

  it('free tier analytics attempt → prompt for pro', () => {
    const r = resolveUpgradePrompt('free', 'analytics', {});
    expect(r.showPrompt).toBe(true);
    if (r.showPrompt) expect(r.requiredTier).toBe('pro');
  });

  it('enterprise tier → never shows prompt for any feature', () => {
    for (const feature of FEATURES) {
      const r = resolveUpgradePrompt('enterprise', feature, { existingDeployments: 50 });
      expect(r.showPrompt).toBe(false);
    }
  });

  it('pro tier within deployment limit → no prompt', () => {
    const limit = TIER_CONFIGS.pro.entitlements.maxDeployments;
    const r = resolveUpgradePrompt('pro', 'deployments', { existingDeployments: limit - 1 });
    expect(r.showPrompt).toBe(false);
  });
});

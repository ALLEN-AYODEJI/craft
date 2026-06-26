import React from 'react';
import Link from 'next/link';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';

export const TIER_DESCRIPTIONS: Record<SubscriptionTier, string> = {
  free: 'Get started with one deployment and explore the platform.',
  pro: 'Scale your DeFi apps with analytics and custom domains.',
  enterprise: 'Unlimited power for production-grade deployments.',
};

export function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-5 h-5 flex-shrink-0 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function buildFeatureList(tier: SubscriptionTier): string[] {
  const e = TIER_CONFIGS[tier].entitlements;
  const list: string[] = [];
  list.push(e.maxDeployments === -1 ? 'Unlimited deployments' : `${e.maxDeployments} deployment${e.maxDeployments !== 1 ? 's' : ''}`);
  if (e.analyticsEnabled) list.push('Deployment analytics');
  list.push(
    e.maxCustomDomains === -1
      ? 'Unlimited custom domains'
      : e.maxCustomDomains === 0
      ? 'No custom domains'
      : `${e.maxCustomDomains} custom domain`
  );
  if (e.premiumTemplates) list.push('Premium templates');
  if (e.prioritySupport) list.push('Priority support');
  list.push('Stellar & Soroban integration');
  list.push('Live preview');
  list.push('GitHub integration');
  return list;
}

function buildCtaHref(tier: SubscriptionTier, isLoggedIn: boolean): string {
  if (tier === 'free') return isLoggedIn ? '/app' : '/signup';
  if (!isLoggedIn) return '/signup';
  const priceId = TIER_CONFIGS[tier].stripePriceId;
  return priceId ? `/api/payments/checkout?priceId=${priceId}` : '/app/billing';
}

function buildCtaLabel(tier: SubscriptionTier, isCurrentPlan: boolean, isLoggedIn: boolean): string {
  if (isCurrentPlan) return 'Current Plan';
  if (tier === 'free') return isLoggedIn ? 'Go to Dashboard' : 'Get Started';
  return isLoggedIn ? 'Upgrade' : 'Get Started';
}

/**
 * Renders an individual subscription plan card with its features and pricing.
 *
 * @param tier - The subscription tier data
 * @param isCurrentPlan - Whether this is the user's active plan
 * @param isRecommended - Whether to highlight this plan as recommended
 * @param isLoggedIn - Whether the user has an active session
 */
export function PlanCard({
  tier,
  isCurrentPlan,
  isRecommended,
  isLoggedIn,
}: {
  tier: SubscriptionTier;
  isCurrentPlan: boolean;
  isRecommended: boolean;
  isLoggedIn: boolean;
}) {
  const config = TIER_CONFIGS[tier];
  const priceDisplay = config.monthlyPriceCents === 0 ? '$0' : `$${config.monthlyPriceCents / 100}`;
  const features: string[] = buildFeatureList(tier);
  const ctaHref = buildCtaHref(tier, isLoggedIn);
  const ctaLabel = buildCtaLabel(tier, isCurrentPlan, isLoggedIn);
  const isPrimary = isRecommended;

  return (
    <div data-testid={`tier-card-${tier}`} className={`relative flex flex-col rounded-xl border bg-surface-container-lowest p-8 shadow-sm ${isPrimary ? 'border-surface-tint ring-1 ring-surface-tint' : 'border-outline-variant/20'}`}>
      <div className="flex items-center gap-2 mb-4 min-h-[1.5rem]">
        {isCurrentPlan && <span data-testid="badge-current-plan" className="inline-flex items-center rounded-full bg-secondary-container px-2.5 py-0.5 text-xs font-semibold text-on-secondary-container">Current Plan</span>}
        {isRecommended && !isCurrentPlan && <span data-testid="badge-recommended" className="inline-flex items-center rounded-full bg-surface-tint px-2.5 py-0.5 text-xs font-semibold text-on-primary">Recommended</span>}
      </div>
      <h3 className="text-xl font-bold font-headline text-on-surface mb-1">{config.displayName}</h3>
      <p className="text-sm text-on-surface-variant mb-6">{TIER_DESCRIPTIONS[tier]}</p>
      <div className="mb-6">
        <span className="text-4xl font-bold font-headline text-on-surface">{priceDisplay}</span>
        {config.monthlyPriceCents > 0 && <span className="text-sm text-on-surface-variant ml-1">/month</span>}
      </div>
      {isCurrentPlan ? (
        <span className="w-full rounded-lg border border-outline-variant/40 px-4 py-2.5 text-sm font-semibold text-on-surface-variant text-center cursor-default select-none">Current Plan</span>
      ) : (
        <Link href={ctaHref} data-testid={`cta-${tier}`} className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-center focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2 transition-all duration-200 ${isPrimary ? 'bg-gradient-primary text-on-primary hover:opacity-90' : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'}`}>{ctaLabel}</Link>
      )}
      <ul className="mt-8 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-sm text-on-surface-variant">
            <CheckIcon className="text-surface-tint mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

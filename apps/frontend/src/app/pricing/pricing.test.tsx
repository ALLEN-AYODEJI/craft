/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PricingClient from './PricingClient';

vi.mock('next/link', () => {
  return {
    default: (props: any) => {
      return <a href={props.href} data-testid={props['data-testid']}>{props.children}</a>;
    }
  };
});

vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free: { displayName: 'Free', monthlyPriceCents: 0, entitlements: { maxDeployments: 1, maxCustomDomains: 0, analyticsEnabled: false, premiumTemplates: false, prioritySupport: false }, stripePriceId: null },
    pro: { displayName: 'Pro', monthlyPriceCents: 2900, entitlements: { maxDeployments: 10, maxCustomDomains: 1, analyticsEnabled: true, premiumTemplates: true, prioritySupport: false }, stripePriceId: 'price_pro' },
    enterprise: { displayName: 'Enterprise', monthlyPriceCents: 9900, entitlements: { maxDeployments: -1, maxCustomDomains: -1, analyticsEnabled: true, premiumTemplates: true, prioritySupport: true }, stripePriceId: 'price_ent' }
  }
}));

describe('PricingClient', () => {
  it('renders all pricing tiers', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByTestId('tier-card-free')).toBeDefined();
    expect(screen.getByTestId('tier-card-pro')).toBeDefined();
    expect(screen.getByTestId('tier-card-enterprise')).toBeDefined();
  });

  it('has correct checkout links when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByTestId('cta-pro').getAttribute('href')).toBe('/signup');
  });

  it('has correct checkout links when logged in', () => {
    render(<PricingClient isLoggedIn={true} currentTier={null} />);
    expect(screen.getByTestId('cta-pro').getAttribute('href')).toBe('/api/payments/checkout?priceId=price_pro');
  });
});

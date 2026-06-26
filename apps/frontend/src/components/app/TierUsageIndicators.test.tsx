/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TierUsageIndicators } from './TierUsageIndicators';

vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free: { displayName: 'Free' },
    pro: { displayName: 'Pro' },
    enterprise: { displayName: 'Enterprise' },
  },
  getEntitlements: (tier: 'free' | 'pro' | 'enterprise') => {
    if (tier === 'free') {
      return { maxDeployments: 1, maxCustomDomains: 0 };
    }
    if (tier === 'pro') {
      return { maxDeployments: 10, maxCustomDomains: 1 };
    }
    return { maxDeployments: -1, maxCustomDomains: -1 };
  },
}));

describe('TierUsageIndicators', () => {
  it('renders deployment progress for all tiers', () => {
    render(
      <TierUsageIndicators
        tier="free"
        activeDeployments={1}
        activeCustomDomains={0}
      />
    );

    expect(screen.getByLabelText('Deployments usage')).toBeDefined();
  });

  it('shows domain usage for pro and enterprise tiers only', () => {
    const { rerender } = render(
      <TierUsageIndicators
        tier="free"
        activeDeployments={0}
        activeCustomDomains={0}
      />
    );

    expect(screen.queryByLabelText('Domains usage')).toBeNull();

    rerender(
      <TierUsageIndicators
        tier="pro"
        activeDeployments={1}
        activeCustomDomains={1}
      />
    );

    expect(screen.getByLabelText('Domains usage')).toBeDefined();
  });

  it('shows warning state when usage is approaching deployment limit', () => {
    render(
      <TierUsageIndicators
        tier="pro"
        activeDeployments={8}
        activeCustomDomains={0}
      />
    );

    expect(screen.getByTestId('deployments-warning')).toBeDefined();
  });

  it('shows critical state when limit is reached', () => {
    render(
      <TierUsageIndicators
        tier="pro"
        activeDeployments={10}
        activeCustomDomains={1}
      />
    );

    expect(screen.getByTestId('deployments-critical')).toBeDefined();
    expect(screen.getByTestId('domains-critical')).toBeDefined();
  });

  it('shows unlimited indicators for enterprise tier', () => {
    render(
      <TierUsageIndicators
        tier="enterprise"
        activeDeployments={32}
        activeCustomDomains={6}
      />
    );

    expect(screen.getByTestId('deployments-usage-unlimited')).toBeDefined();
    expect(screen.getByTestId('domains-usage-unlimited')).toBeDefined();
  });
});

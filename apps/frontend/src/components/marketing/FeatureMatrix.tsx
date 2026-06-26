import React from 'react';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';
import { CheckIcon } from './PlanCard';

export interface MatrixFeature {
  label: string;
  free: string | boolean;
  pro: string | boolean;
  enterprise: string | boolean;
}

export const MATRIX_FEATURES: MatrixFeature[] = [
  { label: 'Deployments',        free: '1',         pro: '10',        enterprise: 'Unlimited' },
  { label: 'Analytics',          free: false,        pro: true,        enterprise: true },
  { label: 'Custom domains',     free: false,        pro: '1',         enterprise: 'Unlimited' },
  { label: 'Premium templates',  free: false,        pro: true,        enterprise: true },
  { label: 'Priority support',   free: false,        pro: false,       enterprise: true },
  { label: 'Stellar integration',free: true,         pro: true,        enterprise: true },
  { label: 'Live preview',       free: true,         pro: true,        enterprise: true },
  { label: 'GitHub integration', free: true,         pro: true,        enterprise: true },
];

export function CrossIcon() {
  return (
    <svg className="w-5 h-5 flex-shrink-0 text-outline" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export function MatrixCell({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    return value ? <CheckIcon className="text-surface-tint mx-auto" /> : <CrossIcon />;
  }
  return <span className="text-sm font-medium text-on-surface">{value}</span>;
}

/**
 * Displays a comprehensive feature comparison matrix across all available subscription tiers.
 *
 * @param tiers - The available subscription tiers
 */
export function FeatureMatrix({ tiers }: { tiers: SubscriptionTier[] }) {
  return (
    <section aria-label="Feature comparison" className="bg-surface-container-low py-20 px-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold font-headline text-on-surface text-center mb-12">Compare plans</h2>
        <div className="overflow-x-auto rounded-xl border border-outline-variant/20 shadow-sm">
          <table className="w-full min-w-[480px] bg-surface-container-lowest">
            <thead>
              <tr className="border-b border-outline-variant/20">
                <th className="text-left px-6 py-4 text-sm font-semibold text-on-surface w-1/2">Feature</th>
                {tiers.map((t) => (
                  <th key={t} scope="col" className={`px-4 py-4 text-center text-sm font-semibold ${t === 'pro' ? 'text-surface-tint' : 'text-on-surface'}`}>
                    {TIER_CONFIGS[t].displayName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_FEATURES.map((row, i) => (
                <tr key={row.label} className={`border-b border-outline-variant/10 last:border-0 ${i % 2 === 0 ? '' : 'bg-surface-container-low/40'}`}>
                  <td className="px-6 py-4 text-sm text-on-surface-variant">{row.label}</td>
                  <td className="px-4 py-4 text-center"><MatrixCell value={row.free} /></td>
                  <td className="px-4 py-4 text-center"><MatrixCell value={row.pro} /></td>
                  <td className="px-4 py-4 text-center"><MatrixCell value={row.enterprise} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

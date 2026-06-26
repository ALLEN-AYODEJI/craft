'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { SubscriptionTier } from '@craft/types';
import { PlanCard } from '@/components/marketing/PlanCard';
import { FeatureMatrix } from '@/components/marketing/FeatureMatrix';

interface PricingClientProps {
  currentTier?: SubscriptionTier | null;
  isLoggedIn: boolean;
}

const TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

const FAQS = [
  { q: 'Can I upgrade or downgrade at any time?', a: 'Yes. Plan changes take effect immediately. If you upgrade mid-cycle you are charged a prorated amount; downgrades apply at the next billing date.' },
  { q: 'What happens when I hit my deployment limit?', a: 'You will be prompted to upgrade. Existing deployments remain active — you just cannot create new ones until you upgrade or remove an existing deployment.' },
  { q: 'Is there a free trial for Pro or Enterprise?', a: 'The Free tier lets you explore the platform with no time limit. Reach out to us if you need a full-feature trial before committing.' },
  { q: 'How does billing work?', a: 'Plans are billed monthly via Stripe. You can cancel at any time and retain access until the end of the billing period.' },
  { q: 'Do you offer discounts for annual billing?', a: 'Annual billing with a 20% discount is coming soon. Sign up for our newsletter to be notified when it launches.' },
];

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const id = `faq-${q.replace(/\s+/g, '-').toLowerCase().slice(0, 30)}`;

  return (
    <div className="border-b border-outline-variant/30 last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={id} className="w-full flex items-center justify-between gap-4 py-5 text-left text-on-surface font-medium text-sm focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-inset rounded">
        <span>{q}</span>
        <svg className={`w-5 h-5 flex-shrink-0 text-on-surface-variant transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div id={id} role="region" aria-labelledby={id} className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 pb-5' : 'max-h-0'}`}>
        <p className="text-sm text-on-surface-variant leading-relaxed">{a}</p>
      </div>
    </div>
  );
}

/**
 * Client-side container for the pricing page.
 * Handles user state and tier selection.
 *
 * @param isLoggedIn - Boolean indicating if the user has an active session
 * @param currentTier - The user's current active subscription tier, if any
 */
export default function PricingClient({ currentTier, isLoggedIn }: PricingClientProps) {
  return (
    <>
      {/* Hero */}
      <section className="pt-24 pb-16 px-6 text-center">
        <p className="text-xs font-bold tracking-[0.2em] text-surface-tint uppercase mb-4">Pricing</p>
        <h1 className="text-4xl lg:text-5xl font-bold font-headline text-on-surface mb-4">Simple, transparent pricing</h1>
        <p className="text-lg text-on-surface-variant max-w-2xl mx-auto">Start free, scale when you&apos;re ready. No hidden fees, no surprises.</p>
      </section>

      {/* Tier Cards */}
      <section aria-label="Pricing tiers" className="max-w-6xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-3 gap-8">
        {TIERS.map((tier) => (
          <PlanCard key={tier} tier={tier} isCurrentPlan={isLoggedIn && currentTier === tier} isRecommended={tier === 'pro'} isLoggedIn={isLoggedIn} />
        ))}
      </section>

      {/* Feature Matrix */}
      <FeatureMatrix tiers={TIERS} />

      {/* FAQ */}
      <section aria-label="Frequently asked questions" className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold font-headline text-on-surface text-center mb-10">Frequently asked questions</h2>
        <div role="list" className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 px-6 shadow-sm">
          {FAQS.map((faq) => (
            <div role="listitem" key={faq.q}>
              <FAQItem q={faq.q} a={faq.a} />
            </div>
          ))}
        </div>
      </section>

      {/* Sticky CTA Banner */}
      <div aria-label="Upgrade call to action" className="sticky bottom-0 z-40 bg-primary/95 backdrop-blur-sm border-t border-on-primary/10 py-4 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm font-medium text-on-primary text-center sm:text-left">Ready to scale your DeFi deployments?</p>
          <Link href={isLoggedIn ? '/app/billing' : '/signup'} data-testid="sticky-cta" className="shrink-0 rounded-lg bg-on-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary focus:outline-none focus:ring-2 focus:ring-on-primary hover:opacity-90 transition-all duration-200">
            {isLoggedIn ? 'Manage Billing' : 'Get Started Free'}
          </Link>
        </div>
      </div>
    </>
  );
}

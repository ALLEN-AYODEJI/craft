/**
 * Property 49 – Stellar Example Code Inclusion
 *
 * "For every template family and any valid customization configuration, the
 *  generated output MUST include example code for common Stellar operations:
 *  loadAccount, getAccountBalance, submitTransaction in stellar.ts; sendPayment
 *  in payment.ts (payment-gateway); issueAsset / StellarSdk.Asset in asset.ts
 *  (asset-issuance); invokeContract in soroban.ts (soroban-defi)."
 *
 * Validates: Requirements 7.1, 7.3 (Stellar SDK usage in generated code)
 *
 * Strategy
 * ────────
 * fast-check generates random CustomizationConfig values across the full
 * input space (all four template families × arbitrary branding/feature/stellar
 * combos). For each generated input we run CodeGeneratorService.generate()
 * synchronously and assert that the expected Stellar operation symbols are
 * present in the relevant generated files.
 *
 * Minimum 100 iterations (numRuns: 100) as required by the spec.
 *
 * Issue: add-property-test-for-stellar-example-code-inclu
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CodeGeneratorService, type TemplateFamilyId } from './code-generator.service';
import type { CustomizationConfig } from '@craft/types';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const TEMPLATE_FAMILIES: readonly TemplateFamilyId[] = [
  'stellar-dex',
  'soroban-defi',
  'payment-gateway',
  'asset-issuance',
];

const NETWORKS = ['mainnet', 'testnet'] as const;

/** Hex color string e.g. #a1b2c3 */
const arbHexColor = fc
  .stringMatching(/^[0-9a-fA-F]{6}$/)
  .map((h) => `#${h}`);

/** Safe non-empty, non-whitespace-only printable string */
const arbSafeString = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => !/[\x00-\x1f\x7f]/.test(s) && s.trim().length > 0);

const arbCustomization: fc.Arbitrary<CustomizationConfig> = fc
  .constantFrom(...NETWORKS)
  .chain((network) =>
    fc.record<CustomizationConfig>({
      branding: fc.record({
        appName: arbSafeString,
        primaryColor: arbHexColor,
        secondaryColor: arbHexColor,
        fontFamily: arbSafeString,
      }),
      features: fc.record({
        enableCharts: fc.boolean(),
        enableTransactionHistory: fc.boolean(),
        enableAnalytics: fc.boolean(),
        enableNotifications: fc.boolean(),
      }),
      stellar: fc.record({
        network: fc.constant(network),
        horizonUrl: fc.constantFrom(
          'https://horizon-testnet.stellar.org',
          'https://horizon.stellar.org',
          'https://custom-horizon.example.com'
        ),
        // omit sorobanRpcUrl entirely rather than passing undefined
        sorobanRpcUrl: fc.constantFrom(
          'https://soroban-testnet.stellar.org',
          'https://soroban.stellar.org',
          undefined as unknown as string
        ),
        networkPassphrase: fc.constantFrom(
          'Test SDF Network ; September 2015',
          'Public Global Stellar Network ; September 2015'
        ),
      }),
    })
  );

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFile(
  files: { path: string; content: string }[],
  path: string
): string | undefined {
  return files.find((f) => f.path === path)?.content;
}

// ── Property 49 ───────────────────────────────────────────────────────────────

describe('Property 49 – Stellar example code inclusion', () => {
  const svc = new CodeGeneratorService();

  /**
   * All four template families must include stellar.ts with the three core
   * Stellar operation helpers: loadAccount, getAccountBalance, submitTransaction.
   */
  it('stellar.ts always contains loadAccount, getAccountBalance, submitTransaction', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TEMPLATE_FAMILIES),
        arbCustomization,
        (family, customization) => {
          const result = svc.generate({
            templateId: 'test-id',
            customization,
            outputPath: '/tmp/test',
            templateFamily: family,
          });

          expect(result.success).toBe(true);

          const stellar = getFile(result.generatedFiles, 'src/lib/stellar.ts');
          expect(stellar, `stellar.ts missing for family "${family}"`).toBeDefined();
          expect(stellar).toContain('loadAccount');
          expect(stellar).toContain('getAccountBalance');
          expect(stellar).toContain('submitTransaction');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * payment-gateway must include payment.ts with sendPayment and
   * StellarSdk.Operation.payment.
   */
  it('payment-gateway includes sendPayment with StellarSdk.Operation.payment', () => {
    fc.assert(
      fc.property(arbCustomization, (customization) => {
        const result = svc.generate({
          templateId: 'test-id',
          customization,
          outputPath: '/tmp/test',
          templateFamily: 'payment-gateway',
        });

        expect(result.success).toBe(true);

        const payment = getFile(result.generatedFiles, 'src/lib/payment.ts');
        expect(payment, 'payment.ts missing for payment-gateway').toBeDefined();
        expect(payment).toContain('sendPayment');
        expect(payment).toContain('StellarSdk.Operation.payment');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * asset-issuance must include asset.ts with issueAsset, StellarSdk.Asset,
   * and StellarSdk.Operation.payment.
   */
  it('asset-issuance includes issueAsset with StellarSdk.Asset and Operation.payment', () => {
    fc.assert(
      fc.property(arbCustomization, (customization) => {
        const result = svc.generate({
          templateId: 'test-id',
          customization,
          outputPath: '/tmp/test',
          templateFamily: 'asset-issuance',
        });

        expect(result.success).toBe(true);

        const asset = getFile(result.generatedFiles, 'src/lib/asset.ts');
        expect(asset, 'asset.ts missing for asset-issuance').toBeDefined();
        expect(asset).toContain('issueAsset');
        expect(asset).toContain('StellarSdk.Asset');
        expect(asset).toContain('StellarSdk.Operation.payment');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * soroban-defi must include soroban.ts with invokeContract.
   */
  it('soroban-defi includes invokeContract in soroban.ts', () => {
    fc.assert(
      fc.property(arbCustomization, (customization) => {
        const result = svc.generate({
          templateId: 'test-id',
          customization,
          outputPath: '/tmp/test',
          templateFamily: 'soroban-defi',
        });

        expect(result.success).toBe(true);

        const soroban = getFile(result.generatedFiles, 'src/lib/soroban.ts');
        expect(soroban, 'soroban.ts missing for soroban-defi').toBeDefined();
        expect(soroban).toContain('invokeContract');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Composite: every family produces a successful result and stellar.ts
   * imports stellar-sdk — verified across all families simultaneously.
   */
  it('stellar.ts always imports stellar-sdk across all template families', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TEMPLATE_FAMILIES),
        arbCustomization,
        (family, customization) => {
          const result = svc.generate({
            templateId: 'test-id',
            customization,
            outputPath: '/tmp/test',
            templateFamily: family,
          });

          expect(result.success).toBe(true);

          const stellar = getFile(result.generatedFiles, 'src/lib/stellar.ts');
          expect(stellar).toContain("from 'stellar-sdk'");
        }
      ),
      { numRuns: 100 }
    );
  });
});

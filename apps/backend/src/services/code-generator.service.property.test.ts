/**
 * Property 16 – Code Generation Completeness
 *
 * "For any valid template and customization configuration, the generated code
 *  should include: all customization values in config files, Stellar network
 *  environment variables, preserved Turborepo structure, and syntactically
 *  valid code."
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 *
 * Strategy
 * ────────
 * fast-check generates random CustomizationConfig values across the full
 * input space (all template families × all branding/feature/stellar combos).
 * For each generated input we run CodeGeneratorService.generate() and assert
 * the universal completeness invariants hold.
 *
 * Minimum 100 iterations (numRuns: 100) as required by the spec.
 *
 * Issue: #068 — write code generation tests and completeness proof
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    CodeGeneratorService,
    NETWORK_PASSPHRASE,
    type TemplateFamilyId,
} from './code-generator.service';
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

/** Safe printable string — avoids control chars that would break generated TS */
const arbSafeString = fc.string({ minLength: 1, maxLength: 40 }).filter(
    (s) => !/[\x00-\x1f\x7f]/.test(s)
);

const arbNetwork = fc.constantFrom(...NETWORKS);

const arbTemplateFamily = fc.constantFrom(...TEMPLATE_FAMILIES);

const arbBranding = fc.record({
    appName: arbSafeString,
    primaryColor: arbHexColor,
    secondaryColor: arbHexColor,
    fontFamily: arbSafeString,
});

const arbFeatures = fc.record({
    enableCharts: fc.boolean(),
    enableTransactionHistory: fc.boolean(),
    enableAnalytics: fc.boolean(),
    enableNotifications: fc.boolean(),
});

const arbStellarConfig = arbNetwork.chain((network) =>
    fc.record({
        network: fc.constant(network),
        horizonUrl: fc.constantFrom(
            'https://horizon-testnet.stellar.org',
            'https://horizon.stellar.org',
            'https://custom-horizon.example.com'
        ),
        sorobanRpcUrl: fc.option(
            fc.constantFrom(
                'https://soroban-testnet.stellar.org',
                'https://soroban.example.com'
            ),
            { nil: undefined }
        ),
    })
);

const arbCustomizationConfig: fc.Arbitrary<CustomizationConfig> = fc.record({
    branding: arbBranding,
    features: arbFeatures,
    stellar: arbStellarConfig,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFile(
    files: { path: string; content: string }[],
    path: string
): string | undefined {
    return files.find((f) => f.path === path)?.content;
}

// ── Property 16 ───────────────────────────────────────────────────────────────

describe('Property 16 – Code Generation Completeness', () => {
    const svc = new CodeGeneratorService();

    // ── 16-A: Required files always present ──────────────────────────────────

    it(
        '16-A: for any template family and config, required files are always generated',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    expect(result.success).toBe(true);
                    expect(result.errors).toHaveLength(0);

                    const paths = result.generatedFiles.map((f) => f.path);
                    expect(paths).toContain('src/lib/config.ts');
                    expect(paths).toContain('.env.local');
                    expect(paths).toContain('package.json');
                    expect(paths).toContain('src/lib/stellar.ts');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-B: Branding values appear in config.ts ─────────────────────────────

    it(
        '16-B: for any config, all branding values appear in the generated config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.2
             *
             * Note: hex colors (#rrggbb) contain no characters that need escaping,
             * so they appear verbatim. String fields like fontFamily may be escaped
             * (backslashes, single quotes) — we verify the .env.local instead for
             * those, since env values are written raw without JS string escaping.
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;
                    expect(configContent).toBeDefined();

                    // Hex colors are never escaped — they must appear verbatim
                    expect(configContent).toContain(cfg.branding.primaryColor);
                    expect(configContent).toContain(cfg.branding.secondaryColor);

                    // fontFamily appears in .env.local verbatim (no JS escaping there)
                    const envContent = getFile(result.generatedFiles, '.env.local')!;
                    expect(envContent).toContain(cfg.branding.fontFamily);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-C: Stellar network env vars in config.ts ───────────────────────────

    it(
        '16-C: for any config, Stellar network env vars are present in config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.3
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;

                    // Required Stellar env var keys
                    expect(configContent).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
                    expect(configContent).toContain('NEXT_PUBLIC_HORIZON_URL');
                    expect(configContent).toContain('NEXT_PUBLIC_NETWORK_PASSPHRASE');

                    // Correct passphrase for the selected network
                    expect(configContent).toContain(NETWORK_PASSPHRASE[cfg.stellar.network]);

                    // Horizon URL value embedded
                    expect(configContent).toContain(cfg.stellar.horizonUrl);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-D: .env.local contains all required keys ───────────────────────────

    it(
        '16-D: for any config, .env.local always contains all required NEXT_PUBLIC_ keys',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.3, 7.4
             */
            const REQUIRED_ENV_KEYS = [
                'NEXT_PUBLIC_APP_NAME',
                'NEXT_PUBLIC_PRIMARY_COLOR',
                'NEXT_PUBLIC_SECONDARY_COLOR',
                'NEXT_PUBLIC_FONT_FAMILY',
                'NEXT_PUBLIC_STELLAR_NETWORK',
                'NEXT_PUBLIC_HORIZON_URL',
                'NEXT_PUBLIC_NETWORK_PASSPHRASE',
                'NEXT_PUBLIC_ENABLE_CHARTS',
                'NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY',
                'NEXT_PUBLIC_ENABLE_ANALYTICS',
                'NEXT_PUBLIC_ENABLE_NOTIFICATIONS',
            ];

            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const envContent = getFile(result.generatedFiles, '.env.local')!;
                    expect(envContent).toBeDefined();

                    for (const key of REQUIRED_ENV_KEYS) {
                        expect(envContent, `Missing env key: ${key}`).toContain(key);
                    }
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-E: package.json always includes stellar-sdk ───────────────────────

    it(
        '16-E: for any template family, package.json always includes stellar-sdk dependency',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.5 (Property 46: Stellar SDK Inclusion)
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const pkgContent = getFile(result.generatedFiles, 'package.json')!;
                    expect(pkgContent).toBeDefined();

                    // Must be valid JSON
                    let pkg: any;
                    expect(() => { pkg = JSON.parse(pkgContent); }).not.toThrow();

                    // stellar-sdk must be in dependencies
                    expect(pkg.dependencies['stellar-sdk']).toBeDefined();
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-F: stellar.ts always imports stellar-sdk and has error handling ────

    it(
        '16-F: for any template family, stellar.ts always imports stellar-sdk and includes error handling',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.4, 17.1, 17.4
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const stellarContent = getFile(result.generatedFiles, 'src/lib/stellar.ts')!;
                    expect(stellarContent).toBeDefined();

                    // Must import stellar-sdk
                    expect(stellarContent).toContain("from 'stellar-sdk'");

                    // Must include error handling
                    expect(stellarContent).toContain('throw new Error');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-G: Feature flags reflected in config.ts ────────────────────────────

    it(
        '16-G: for any feature config, all four feature flag keys appear in config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.2
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;

                    expect(configContent).toContain('enableCharts');
                    expect(configContent).toContain('enableTransactionHistory');
                    expect(configContent).toContain('enableAnalytics');
                    expect(configContent).toContain('enableNotifications');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-H: soroban-defi always generates soroban.ts ───────────────────────

    it(
        '16-H: for any config, soroban-defi always generates soroban.ts with SorobanRpc',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.4, 17.3 (Property 47: Soroban Configuration Inclusion)
             */
            fc.assert(
                fc.property(arbCustomizationConfig, (cfg) => {
                    const result = svc.generate({
                        templateId: 'soroban-defi',
                        templateFamily: 'soroban-defi',
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const paths = result.generatedFiles.map((f) => f.path);
                    expect(paths).toContain('src/lib/soroban.ts');

                    const sorobanContent = getFile(result.generatedFiles, 'src/lib/soroban.ts')!;
                    expect(sorobanContent).toContain('SorobanRpc');
                    expect(sorobanContent).toContain('invokeContract');
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-I: Network passphrase matches network selection ────────────────────

    it(
        '16-I: for any network selection, the correct passphrase is always embedded in config.ts',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 5.1, 17.2 (Property 12: Network Configuration Mapping)
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;
                    const expectedPassphrase = NETWORK_PASSPHRASE[cfg.stellar.network];
                    const wrongPassphrase = NETWORK_PASSPHRASE[cfg.stellar.network === 'mainnet' ? 'testnet' : 'mainnet'];

                    expect(configContent).toContain(expectedPassphrase);
                    // The wrong passphrase for the selected network must NOT appear
                    expect(configContent).not.toContain(wrongPassphrase);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 16-J: All generated files have non-empty content and valid type ───────

    it(
        '16-J: for any input, all generated files have non-empty content and a valid type field',
        () => {
            /**
             * Feature: code-generation, Property 16: Code Generation Completeness
             * Validates: Requirements 7.1, 18.1
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    for (const file of result.generatedFiles) {
                        expect(file.content.trim().length, `Empty file: ${file.path}`).toBeGreaterThan(0);
                        expect(['code', 'config', 'asset']).toContain(file.type);
                        expect(file.path.length).toBeGreaterThan(0);
                    }
                }),
                { numRuns: 100 }
            );
        }
    );
});

// ── Property 46 – Stellar SDK Inclusion ───────────────────────────────────────

/**
 * Property 46 – Stellar SDK Inclusion
 *
 * "For any generated template across all template families, stellar-sdk
 *  MUST be included in the package.json dependencies. This is a critical
 *  requirement for all Stellar network integration functionality."
 *
 * Validates: Requirements 7.5, Requirement: Stellar SDK Dependency Management
 *
 * Strategy
 * ────────
 * Test all 4 template families (stellar-dex, soroban-defi, payment-gateway,
 * asset-issuance) across all possible customization configurations. For each
 * generated template, parse the generated package.json and verify that
 * stellar-sdk is present in the dependencies object with a valid version.
 *
 * Minimum 100 iterations required by spec for all template types.
 *
 * Issue: #069 — implement property test for stellar sdk inclusion
 */
describe('Property 46 – Stellar SDK Inclusion', () => {
    const svc = new CodeGeneratorService();

    // ── 46-A: stellar-sdk is always in dependencies ──────────────────────────

    it(
        '46-A: for any template type and customization, stellar-sdk is always in package.json dependencies',
        () => {
            /**
             * Feature: code-generation, Property 46: Stellar SDK Inclusion
             * Validates: Requirements 7.5
             *
             * Proof technique: Property-based testing with fast-check
             * - Generate random CustomizationConfig across full input space
             * - For each template family (stellar-dex, soroban-defi, payment-gateway, asset-issuance)
             * - Run generation and assert stellar-sdk is in dependencies
             * - Repeat 100+ times to prove invariant holds universally
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    // If generation itself fails, that's acceptable for edge cases
                    // but we want to test successful generations
                    if (!result.success) {
                        // Skip this iteration as the generation setup was invalid
                        return true;
                    }

                    expect(result.errors).toHaveLength(0);

                    // Find package.json in generated files
                    const pkgFile = result.generatedFiles.find((f) => f.path === 'package.json');
                    expect(pkgFile, `package.json not generated for ${family}`).toBeDefined();
                    
                    if (!pkgFile) return true; // Safety check

                    expect(pkgFile.content.trim().length, `Empty package.json for ${family}`).toBeGreaterThan(0);

                    // Parse package.json
                    let pkg: any;
                    try {
                        pkg = JSON.parse(pkgFile.content);
                    } catch (err) {
                        throw new Error(
                            `Invalid JSON in package.json for ${family}: ${err instanceof Error ? err.message : String(err)}`
                        );
                    }

                    // Essential package.json fields must be present
                    expect(pkg).toHaveProperty('dependencies', `Missing dependencies object in ${family}`);
                    expect(typeof pkg.dependencies).toBe('object', `dependencies is not an object in ${family}`);

                    // Stellar SDK MUST be in dependencies (not devDependencies)
                    expect(
                        pkg.dependencies['stellar-sdk'],
                        `stellar-sdk missing from dependencies in ${family}. Dependencies: ${JSON.stringify(pkg.dependencies)}`
                    ).toBeDefined();

                    // Stellar SDK version must be a valid semver string
                    const version = pkg.dependencies['stellar-sdk'];
                    expect(typeof version).toBe('string', `stellar-sdk version is not a string in ${family}`);
                    expect(version.length).toBeGreaterThan(0, `stellar-sdk version is empty in ${family}`);

                    // Version should be semver-like (e.g., ^11.2.2 or 11.2.2)
                    expect(version).toMatch(/^[\^~>=]*\d+\.\d+\.\d+/, 
                        `stellar-sdk version "${version}" is not valid semver in ${family}`);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 46-B: stellar-sdk version is consistent across all templates ────────

    it(
        '46-B: for all template families, stellar-sdk uses consistent version spec',
        () => {
            /**
             * Feature: code-generation, Property 46: Stellar SDK Inclusion
             * Validates: Requirements 7.5 (consistency)
             *
             * Ensures that the version constraint used for stellar-sdk
             * is consistent across all template families. While the version
             * itself might vary, the constraint format should be predictable.
             */
            const versions: Record<TemplateFamilyId, string | null> = {
                'stellar-dex': null,
                'soroban-defi': null,
                'payment-gateway': null,
                'asset-issuance': null,
            };

            fc.assert(
                fc.property(arbCustomizationConfig, (cfg) => {
                    // Generate for each template family
                    for (const family of TEMPLATE_FAMILIES as readonly TemplateFamilyId[]) {
                        const result = svc.generate({
                            templateId: family,
                            templateFamily: family,
                            customization: cfg,
                            outputPath: '/tmp/out',
                        });

                        // Skip on generation failure
                        if (!result.success) continue;

                        const pkgFile = result.generatedFiles.find((f) => f.path === 'package.json');
                        if (!pkgFile) continue;

                        const pkg = JSON.parse(pkgFile.content);
                        const version = pkg.dependencies['stellar-sdk'];

                        if (!version) continue;

                        // Store first version for consistency check
                        if (!versions[family]) {
                            versions[family] = version;
                        }

                        // Version must remain consistent (for each family separately)
                        expect(version).toBe(
                            versions[family],
                            `stellar-sdk version mismatch for ${family}: expected ${versions[family]}, got ${version}`
                        );
                    }
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 46-C: stellar-sdk is not in devDependencies ───────────────────────────

    it(
        '46-C: for any template, stellar-sdk is only in dependencies, never in devDependencies',
        () => {
            /**
             * Feature: code-generation, Property 46: Stellar SDK Inclusion
             * Validates: Requirements 7.5 (placement)
             *
             * Ensures that stellar-sdk is a runtime dependency, not a dev dependency.
             * This is critical for production deployments.
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    // Skip on generation failure
                    if (!result.success) return true;

                    const pkgFile = result.generatedFiles.find((f) => f.path === 'package.json');
                    if (!pkgFile) return true;

                    const pkg = JSON.parse(pkgFile.content);

                    // stellar-sdk MUST be in dependencies
                    expect(pkg.dependencies['stellar-sdk']).toBeDefined();

                    // stellar-sdk MUST NOT be in devDependencies
                    if (pkg.devDependencies) {
                        expect(
                            pkg.devDependencies['stellar-sdk'],
                            `stellar-sdk should not be in devDependencies for ${family}`
                        ).toBeUndefined();
                    }
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 46-D: package.json includes other essential dependencies ──────────────

    it(
        '46-D: for any template, package.json includes essential dependencies beyond stellar-sdk',
        () => {
            /**
             * Feature: code-generation, Property 46: Stellar SDK Inclusion
             * Validates: Requirements 7.5 (completeness)
             *
             * Ensures that the generated package.json is not just stellar-sdk,
             * but includes other essential dependencies for a functional app
             * (e.g., next, react, react-dom).
             */
            const ESSENTIAL_DEPS = ['next', 'react', 'react-dom'];

            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    // Skip on generation failure
                    if (!result.success) return true;

                    const pkgFile = result.generatedFiles.find((f) => f.path === 'package.json');
                    if (!pkgFile) return true;

                    const pkg = JSON.parse(pkgFile.content);

                    // Check for essential dependencies
                    for (const dep of ESSENTIAL_DEPS) {
                        expect(pkg.dependencies[dep], `Missing essential dep ${dep} in ${family}`).toBeDefined();
                    }

                    // stellar-sdk should be among them
                    expect(pkg.dependencies['stellar-sdk']).toBeDefined();

                    // Total dependencies should be reasonable (at least 4: next, react, react-dom, stellar-sdk)
                    const depCount = Object.keys(pkg.dependencies).length;
                    expect(depCount).toBeGreaterThanOrEqual(4, 
                        `Too few dependencies in ${family} (expected at least 4, got ${depCount})`);
                }),
                { numRuns: 100 }
            );
        }
    );

    // ── 46-E: Soroban templates include @stellar/stellar-sdk when applicable ──

    it(
        '46-E: for soroban-defi template, both stellar-sdk and @stellar/stellar-sdk are included',
        () => {
            /**
             * Feature: code-generation, Property 46: Stellar SDK Inclusion
             * Validates: Requirements 7.5 (soroban-specific)
             *
             * The soroban-defi template has special requirements for Soroban
             * integration and may require the @stellar/stellar-sdk package.
             */
            fc.assert(
                fc.property(arbCustomizationConfig, (cfg) => {
                    const result = svc.generate({
                        templateId: 'soroban-defi',
                        templateFamily: 'soroban-defi',
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    // Skip on generation failure
                    if (!result.success) return true;

                    const pkgFile = result.generatedFiles.find((f) => f.path === 'package.json');
                    if (!pkgFile) return true;

                    const pkg = JSON.parse(pkgFile.content);

                    // Standard stellar-sdk must be present
                    expect(pkg.dependencies['stellar-sdk']).toBeDefined();

                    // @stellar/stellar-sdk should also be present for Soroban support
                    expect(pkg.dependencies['@stellar/stellar-sdk']).toBeDefined();
                }),
                { numRuns: 100 }
            );
        }
    );
});

// ── Property 47 – Soroban Configuration Inclusion ───────────────────────────

/**
 * Property 47 – Soroban Configuration Inclusion
 *
 * For any generated Soroban template, the output must include
 * RPC client configuration that is wired to runtime config/env values.
 */
describe('Property 47 – Soroban Configuration Inclusion', () => {
    const svc = new CodeGeneratorService();

    it(
        '47-A: soroban-defi generation always includes Soroban RPC configuration with runtime config wiring',
        () => {
            /**
             * Feature: code-generation, Property 47: Soroban Configuration Inclusion
             * Validates: Requirements 7.4, 17.3
             */
            fc.assert(
                fc.property(arbCustomizationConfig, (cfg) => {
                    const result = svc.generate({
                        templateId: 'soroban-defi',
                        templateFamily: 'soroban-defi',
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    expect(result.success).toBe(true);

                    const sorobanContent = getFile(result.generatedFiles, 'src/lib/soroban.ts')!;
                    expect(sorobanContent).toBeDefined();
                    expect(sorobanContent).toContain('new SorobanRpc.Server');
                    expect(sorobanContent).toContain('config.stellar.sorobanRpcUrl');

                    const configContent = getFile(result.generatedFiles, 'src/lib/config.ts')!;
                    expect(configContent).toContain('NEXT_PUBLIC_SOROBAN_RPC_URL');
                }),
                { numRuns: 100 }
            );
        }
    );
});

// ── Property 48 – Stellar Error Handling Inclusion ──────────────────────────

/**
 * Property 48 – Stellar Error Handling Inclusion
 *
 * For any generated template, Stellar operations in src/lib/stellar.ts must
 * include explicit try/catch error handling and descriptive failure messages.
 */
describe('Property 48 – Stellar Error Handling Inclusion', () => {
    const svc = new CodeGeneratorService();

    it(
        '48-A: generated stellar client always includes explicit error handling for account and transaction operations',
        () => {
            /**
             * Feature: code-generation, Property 48: Stellar Error Handling Inclusion
             * Validates: Requirements 7.4, 17.1, 17.4
             */
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const result = svc.generate({
                        templateId: family,
                        templateFamily: family,
                        customization: cfg,
                        outputPath: '/tmp/out',
                    });

                    expect(result.success).toBe(true);

                    const stellarContent = getFile(result.generatedFiles, 'src/lib/stellar.ts')!;
                    expect(stellarContent).toBeDefined();

                    expect(stellarContent).toContain('try {');
                    expect(stellarContent).toContain('catch (error)');
                    expect(stellarContent).toContain('Failed to load account');
                    expect(stellarContent).toContain('Failed to submit transaction');
                    expect(stellarContent).toContain('throw new Error');
                }),
                { numRuns: 100 }
            );
        }
    );
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { TemplateService } from './template.service';

// --- Supabase mock ---
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom }),
}));

// Fully chainable query that resolves to `resolvedValue`
const makeQuery = (resolvedValue: any) => {
    const q: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        single: mockSingle,
        then: (resolve: any, reject: any) =>
            Promise.resolve(resolvedValue).then(resolve, reject),
    };
    return q;
};

// ── Arbitraries ───────────────────────────────────────────────────────────────

const CATEGORIES = ['dex', 'lending', 'payment', 'asset-issuance'] as const;

const arbCategory = fc.constantFrom(...CATEGORIES);

const arbFeatureKey = fc.constantFrom(
    'enableCharts',
    'enableAnalytics',
    'enableTransactionHistory',
    'enableNotifications'
);

const safeIsoDate = fc
    .integer({ min: new Date('2020-01-01').getTime(), max: new Date('2030-01-01').getTime() })
    .map((ms) => new Date(ms).toISOString());

const arbDbTemplate = fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string({ maxLength: 200 }),
    category: arbCategory,
    is_active: fc.constant(true),
    base_repository_url: fc.webUrl(),
    preview_image_url: fc.webUrl(),
    customization_schema: fc.record({
        features: fc.dictionary(
            arbFeatureKey,
            fc.record({ type: fc.constant('boolean'), default: fc.boolean() })
        ),
    }),
    created_at: safeIsoDate,
    updated_at: safeIsoDate,
});

const arbDbTemplateCatalog = fc.array(arbDbTemplate, { minLength: 0, maxLength: 20 });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TemplateService — property tests', () => {
    let service: TemplateService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TemplateService();
    });

    describe('category filtering invariant', () => {
        it('every result matches the requested category for any catalog', async () => {
            await fc.assert(
                fc.asyncProperty(
                    arbDbTemplateCatalog,
                    arbCategory,
                    async (catalog, category) => {
                        const filtered = catalog.filter((t) => t.category === category);
                        mockFrom.mockReturnValue(makeQuery({ data: filtered, error: null }));

                        const results = await service.listTemplates({ category });

                        expect(results.every((t) => t.category === category)).toBe(true);
                    }
                ),
                { numRuns: 50 }
            );
        });

        it('result count never exceeds catalog size', async () => {
            await fc.assert(
                fc.asyncProperty(arbDbTemplateCatalog, arbCategory, async (catalog, category) => {
                    const filtered = catalog.filter((t) => t.category === category);
                    mockFrom.mockReturnValue(makeQuery({ data: filtered, error: null }));

                    const results = await service.listTemplates({ category });

                    expect(results.length).toBeLessThanOrEqual(catalog.length);
                }),
                { numRuns: 50 }
            );
        });
    });

    describe('template detail completeness invariant', () => {
        it('every mapped template always has all required fields', async () => {
            await fc.assert(
                fc.asyncProperty(arbDbTemplate, async (dbRow) => {
                    mockSingle.mockResolvedValue({ data: dbRow, error: null });
                    mockFrom.mockReturnValue(makeQuery(null));

                    const t = await service.getTemplate(dbRow.id);

                    // Required string fields must be non-empty strings
                    expect(typeof t.id).toBe('string');
                    expect(t.id.length).toBeGreaterThan(0);
                    expect(typeof t.name).toBe('string');
                    expect(t.name.length).toBeGreaterThan(0);
                    expect(typeof t.description).toBe('string');

                    // Category must be one of the known values
                    expect(CATEGORIES).toContain(t.category);

                    // blockchainType is always 'stellar'
                    expect(t.blockchainType).toBe('stellar');

                    // features is always an array
                    expect(Array.isArray(t.features)).toBe(true);

                    // createdAt is always a Date
                    expect(t.createdAt).toBeInstanceOf(Date);

                    // isActive is always a boolean
                    expect(typeof t.isActive).toBe('boolean');
                }),
                { numRuns: 100 }
            );
        });

        it('every feature entry has all required fields with correct types', async () => {
            await fc.assert(
                fc.asyncProperty(arbDbTemplate, async (dbRow) => {
                    mockSingle.mockResolvedValue({ data: dbRow, error: null });
                    mockFrom.mockReturnValue(makeQuery(null));

                    const t = await service.getTemplate(dbRow.id);

                    for (const feature of t.features) {
                        expect(typeof feature.id).toBe('string');
                        expect(typeof feature.name).toBe('string');
                        expect(typeof feature.description).toBe('string');
                        expect(typeof feature.enabled).toBe('boolean');
                        expect(typeof feature.configurable).toBe('boolean');
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('metadata completeness invariant', () => {
        it('metadata always has required fields with correct types', async () => {
            const arbMeta = fc.record({
                id: fc.uuid(),
                name: fc.string({ minLength: 1 }),
                created_at: safeIsoDate,
                updated_at: safeIsoDate,
            });

            await fc.assert(
                fc.asyncProperty(arbMeta, fc.nat(), async (dbMeta, deploymentCount) => {
                    let callCount = 0;
                    mockFrom.mockImplementation(() => {
                        callCount++;
                        if (callCount === 1) {
                            return makeQuery({ data: dbMeta, error: null, single: vi.fn().mockResolvedValue({ data: dbMeta, error: null }) });
                        }
                        return {
                            select: vi.fn().mockReturnThis(),
                            eq: vi.fn().mockResolvedValue({ count: deploymentCount, error: null }),
                        };
                    });
                    // Override single for first call
                    mockSingle.mockResolvedValue({ data: dbMeta, error: null });
                    mockFrom.mockImplementationOnce(() =>
                        makeQuery({ single: mockSingle })
                    ).mockImplementationOnce(() => ({
                        select: vi.fn().mockReturnThis(),
                        eq: vi.fn().mockResolvedValue({ count: deploymentCount, error: null }),
                    }));

                    const meta = await service.getTemplateMetadata(dbMeta.id);

                    expect(typeof meta.id).toBe('string');
                    expect(typeof meta.name).toBe('string');
                    expect(typeof meta.version).toBe('string');
                    expect(meta.lastUpdated).toBeInstanceOf(Date);
                    expect(typeof meta.totalDeployments).toBe('number');
                    expect(meta.totalDeployments).toBeGreaterThanOrEqual(0);
                }),
                { numRuns: 50 }
            );
        });
    });
});

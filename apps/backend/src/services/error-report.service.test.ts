import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorReportService } from './error-report.service';

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: (_table: string) => ({
            insert: mockInsert,
            select: mockSelect,
        }),
    }),
}));

const MOCK_ROW = {
    id: 'report-1',
    user_id: 'user-1',
    correlation_id: 'ERR_001',
    description: 'I clicked deploy and it exploded',
    error_context: { status: 500, message: 'Internal Server Error' },
    status: 'open',
    created_at: '2026-01-01T00:00:00Z',
};

describe('ErrorReportService', () => {
    let service: ErrorReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ErrorReportService();

        // Default chain for insert
        mockInsert.mockReturnValue({
            select: () => ({ single: mockSingle }),
        });

        // Default chain for select (list)
        mockSelect.mockReturnValue({
            eq: () => ({
                order: () => Promise.resolve({ data: [MOCK_ROW], error: null }),
            }),
        });
    });

    describe('submit', () => {
        it('inserts a report and returns mapped result', async () => {
            mockSingle.mockResolvedValue({ data: MOCK_ROW, error: null });

            const result = await service.submit('user-1', {
                correlationId: 'ERR_001',
                description: 'I clicked deploy and it exploded',
                errorContext: { status: 500, message: 'Internal Server Error' },
            });

            expect(result.id).toBe('report-1');
            expect(result.userId).toBe('user-1');
            expect(result.correlationId).toBe('ERR_001');
            expect(result.status).toBe('open');
            expect(result.createdAt).toBeInstanceOf(Date);
        });

        it('maps null correlation_id to undefined', async () => {
            mockSingle.mockResolvedValue({
                data: { ...MOCK_ROW, correlation_id: null },
                error: null,
            });

            const result = await service.submit('user-1', {
                description: 'no correlation',
                errorContext: { message: 'oops' },
            });

            expect(result.correlationId).toBeUndefined();
        });

        it('throws when insert fails', async () => {
            mockSingle.mockResolvedValue({ data: null, error: { message: 'DB error' } });

            await expect(
                service.submit('user-1', {
                    description: 'test',
                    errorContext: { message: 'oops' },
                })
            ).rejects.toThrow('Failed to submit error report: DB error');
        });
    });

    describe('listForUser', () => {
        it('returns reports for a user ordered by created_at desc', async () => {
            const results = await service.listForUser('user-1');
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('report-1');
        });

        it('returns empty array when no reports exist', async () => {
            mockSelect.mockReturnValue({
                eq: () => ({
                    order: () => Promise.resolve({ data: [], error: null }),
                }),
            });

            const results = await service.listForUser('user-1');
            expect(results).toHaveLength(0);
        });

        it('throws when query fails', async () => {
            mockSelect.mockReturnValue({
                eq: () => ({
                    order: () => Promise.resolve({ data: null, error: { message: 'DB error' } }),
                }),
            });

            await expect(service.listForUser('user-1')).rejects.toThrow(
                'Failed to list error reports: DB error'
            );
        });
    });
});

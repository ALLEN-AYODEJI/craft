import { describe, it, expect } from 'vitest';
import { isRetryableError, getRetryHint } from './retryable-error';

describe('isRetryableError', () => {
  it('returns true for network errors (no status)', () => {
    expect(isRetryableError({ message: 'Failed to fetch' })).toBe(true);
  });

  it('returns true for 429 Too Many Requests', () => {
    expect(isRetryableError({ status: 429, message: 'Rate limited' })).toBe(true);
  });

  it('returns true for 500 Internal Server Error', () => {
    expect(isRetryableError({ status: 500, message: 'Server error' })).toBe(true);
  });

  it('returns true for 503 Service Unavailable', () => {
    expect(isRetryableError({ status: 503, message: 'Service unavailable' })).toBe(true);
  });

  it('returns false for 400 Bad Request', () => {
    expect(isRetryableError({ status: 400, message: 'Bad request' })).toBe(false);
  });

  it('returns false for 401 Unauthorized', () => {
    expect(isRetryableError({ status: 401, message: 'Unauthorized' })).toBe(false);
  });

  it('returns false for 403 Forbidden', () => {
    expect(isRetryableError({ status: 403, message: 'Forbidden' })).toBe(false);
  });

  it('returns false for 404 Not Found', () => {
    expect(isRetryableError({ status: 404, message: 'Not found' })).toBe(false);
  });

  it('returns false for 422 Unprocessable Entity', () => {
    expect(isRetryableError({ status: 422, message: 'Validation failed' })).toBe(false);
  });
});

describe('getRetryHint', () => {
  it('returns a hint for network errors', () => {
    const hint = getRetryHint({ message: 'Failed to fetch' });
    expect(hint).toContain('connection');
  });

  it('returns a rate-limit hint for 429', () => {
    const hint = getRetryHint({ status: 429, message: 'Rate limited' });
    expect(hint).toContain('rate limit');
  });

  it('returns a generic hint for 5xx', () => {
    const hint = getRetryHint({ status: 500, message: 'Server error' });
    expect(hint).toContain('temporary');
  });

  it('returns undefined for non-retryable errors', () => {
    expect(getRetryHint({ status: 400, message: 'Bad request' })).toBeUndefined();
    expect(getRetryHint({ status: 403, message: 'Forbidden' })).toBeUndefined();
    expect(getRetryHint({ status: 422, message: 'Validation failed' })).toBeUndefined();
  });
});

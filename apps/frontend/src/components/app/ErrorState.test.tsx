import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorState } from './ErrorState';

describe('ErrorState', () => {
  it('renders title and message', () => {
    render(<ErrorState message="Something failed" />);
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Something failed')).toBeDefined();
  });

  it('renders custom title', () => {
    render(<ErrorState title="Custom Title" message="msg" />);
    expect(screen.getByText('Custom Title')).toBeDefined();
  });

  it('renders errorCode when provided', () => {
    render(<ErrorState message="msg" errorCode="ERR_001" />);
    expect(screen.getByText('ERR_001')).toBeDefined();
  });

  it('shows retry button when onRetry provided and no error object', () => {
    render(<ErrorState message="msg" onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
  });

  it('shows retry button for retryable errors (5xx)', () => {
    render(
      <ErrorState
        message="Server error"
        error={{ status: 500, message: 'Server error' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
  });

  it('shows retry button for 429 rate limit errors', () => {
    render(
      <ErrorState
        message="Rate limited"
        error={{ status: 429, message: 'Rate limited' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
  });

  it('shows retry button for network errors (no status)', () => {
    render(
      <ErrorState
        message="Network error"
        error={{ message: 'Failed to fetch' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
  });

  it('hides retry button for non-retryable errors (400)', () => {
    render(
      <ErrorState
        message="Bad request"
        error={{ status: 400, message: 'Bad request' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
  });

  it('hides retry button for 401 Unauthorized', () => {
    render(
      <ErrorState
        message="Unauthorized"
        error={{ status: 401, message: 'Unauthorized' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
  });

  it('hides retry button for 403 Forbidden', () => {
    render(
      <ErrorState
        message="Forbidden"
        error={{ status: 403, message: 'Forbidden' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
  });

  it('hides retry button for 422 validation errors', () => {
    render(
      <ErrorState
        message="Validation failed"
        error={{ status: 422, message: 'Validation failed' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
  });

  it('shows retry hint for retryable errors', () => {
    render(
      <ErrorState
        message="Server error"
        error={{ status: 500, message: 'Server error' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByText(/temporary/i)).toBeDefined();
  });

  it('does not show retry hint for non-retryable errors', () => {
    render(
      <ErrorState
        message="Bad request"
        error={{ status: 400, message: 'Bad request' }}
        onRetry={vi.fn()}
      />
    );
    expect(screen.queryByText(/temporary/i)).toBeNull();
  });

  it('shows support button when onSupport provided', () => {
    render(<ErrorState message="msg" onSupport={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Contact Support' })).toBeDefined();
  });

  it('shows both retry and support buttons together', () => {
    render(
      <ErrorState
        message="Server error"
        error={{ status: 500, message: 'Server error' }}
        onRetry={vi.fn()}
        onSupport={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Contact Support' })).toBeDefined();
  });

  it('shows only support button for non-retryable errors', () => {
    render(
      <ErrorState
        message="Forbidden"
        error={{ status: 403, message: 'Forbidden' }}
        onRetry={vi.fn()}
        onSupport={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Contact Support' })).toBeDefined();
  });
});

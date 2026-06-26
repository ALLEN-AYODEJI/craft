import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RetryButton } from './RetryButton';

describe('RetryButton', () => {
  it('renders with default label', () => {
    render(<RetryButton onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
  });

  it('renders with custom label', () => {
    render(<RetryButton onRetry={vi.fn()} label="Reload" />);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });

  it('calls onRetry when clicked', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<RetryButton onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onRetry).toHaveBeenCalledOnce());
  });

  it('shows loading state while retrying', async () => {
    let resolve: () => void;
    const onRetry = vi.fn(() => new Promise<void>((r) => { resolve = r; }));

    render(<RetryButton onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retrying…' })).toBeDefined();
    });

    resolve!();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeDefined();
    });
  });

  it('disables the button while loading', async () => {
    let resolve: () => void;
    const onRetry = vi.fn(() => new Promise<void>((r) => { resolve = r; }));

    render(<RetryButton onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      const btn = screen.getByRole('button') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    resolve!();
  });

  it('re-enables the button after retry completes', async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<RetryButton onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      const btn = screen.getByRole('button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('re-enables the button after retry throws', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('fail'));
    render(<RetryButton onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      const btn = screen.getByRole('button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('does not call onRetry again while loading (autoDisable)', async () => {
    let resolve: () => void;
    const onRetry = vi.fn(() => new Promise<void>((r) => { resolve = r; }));

    render(<RetryButton onRetry={onRetry} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);
    fireEvent.click(btn); // second click while loading

    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    resolve!();
  });
});

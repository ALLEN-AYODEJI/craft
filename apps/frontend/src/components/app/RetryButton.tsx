'use client';

import React, { useState, useCallback } from 'react';

interface RetryButtonProps {
  onRetry: () => Promise<void> | void;
  label?: string;
  /** Disables the button while a retry is in-flight. Defaults to true. */
  autoDisable?: boolean;
  className?: string;
}

/**
 * A button that triggers a retry action and shows a loading spinner
 * while the operation is in-flight. Prevents double-clicks via autoDisable.
 */
export function RetryButton({
  onRetry,
  label = 'Try Again',
  autoDisable = true,
  className = '',
}: RetryButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await onRetry();
    } catch {
      // Errors are the caller's responsibility — we just reset loading state.
    } finally {
      setLoading(false);
    }
  }, [loading, onRetry]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={autoDisable && loading}
      aria-busy={loading}
      aria-label={loading ? 'Retrying…' : label}
      className={`
        inline-flex items-center gap-2
        primary-gradient text-on-primary
        px-6 py-3 rounded-lg font-semibold
        shadow-md hover:shadow-lg transition-all active:scale-95
        disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
        ${className}
      `.trim()}
    >
      {loading && (
        <svg
          className="w-4 h-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
      )}
      {loading ? 'Retrying…' : label}
    </button>
  );
}

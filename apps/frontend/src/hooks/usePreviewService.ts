'use client';

import { useCallback, useState } from 'react';
import { ViewportClass, CustomizationConfig, PreviewData } from '@craft/types';
import { previewService } from '@/services/preview.service';

interface UsePreviewServiceReturn {
  generatePreview: (customization: CustomizationConfig, viewport: ViewportClass) => Promise<PreviewData>;
  refreshPreview: (customization: CustomizationConfig, viewport: ViewportClass) => Promise<PreviewData>;
  isLoading: boolean;
  error: string | null;
}

export function usePreviewService(): UsePreviewServiceReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePreview = useCallback(
    async (customization: CustomizationConfig, viewport: ViewportClass): Promise<PreviewData> => {
      setIsLoading(true);
      setError(null);

      try {
        const previewData = previewService.generatePreview(customization, viewport) as PreviewData;
        return previewData;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to generate preview';
        setError(errorMessage);
        throw new Error(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const refreshPreview = useCallback(
    async (customization: CustomizationConfig, viewport: ViewportClass): Promise<PreviewData> => {
      return generatePreview(customization, viewport);
    },
    [generatePreview]
  );

  return {
    generatePreview,
    refreshPreview,
    isLoading,
    error,
  };
}

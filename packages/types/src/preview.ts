import { CustomizationConfig } from './customization';
import { StellarMockData } from './stellar';

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface PreviewPayload {
    customization: CustomizationConfig;
    mockData: StellarMockData;
    timestamp: string;
}

export interface PreviewAsset {
    url: string;
    type: 'image' | 'font' | 'icon';
}

export interface PreviewData {
    html: string;
    css: string;
    assets: PreviewAsset[];
    mockData: StellarMockData;
}
export interface PreviewUpdate {
    changes: DeepPartial<CustomizationConfig>;
    changedFields: string[];
    requiresMockDataRefresh: boolean;
}

export interface PreviewUpdatePayload {
    customization: CustomizationConfig;
    mockData?: StellarMockData;
    changedFields: string[];
    timestamp: string;
}

export type PreviewStatus = 'loading' | 'ready' | 'error';

export type ViewportClass = 'mobile' | 'tablet' | 'desktop';

export const VIEWPORT_DIMENSIONS: Record<ViewportClass, { width: number; height: number }> = {
    mobile: { width: 375, height: 812 },
    tablet: { width: 768, height: 1024 },
    desktop: { width: 1440, height: 900 },
};

'use client';

import React from 'react';
import { ViewportClass, VIEWPORT_DIMENSIONS, PreviewStatus } from '@craft/types';

interface PreviewControlsProps {
  readonly activeViewport: ViewportClass;
  readonly onViewportChange: (viewport: ViewportClass) => void;
  readonly onRefresh: () => void;
  readonly isRefreshing: boolean;
  readonly status: PreviewStatus;
}

const VIEWPORT_LABELS: Record<ViewportClass, string> = {
  desktop: 'Desktop',
  tablet: 'Tablet',
  mobile: 'Mobile',
};

const ViewportIcon: React.FC<{ type: ViewportClass; className?: string }> = ({ type, className = '' }) => {
  switch (type) {
    case 'desktop':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2"/>
          <line x1="8" y1="21" x2="16" y2="21" strokeWidth="2"/>
          <line x1="12" y1="17" x2="12" y2="21" strokeWidth="2"/>
        </svg>
      );
    case 'tablet':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="5" y="2" width="14" height="20" rx="2" strokeWidth="2"/>
          <line x1="12" y1="18" x2="12" y2="18" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      );
    case 'mobile':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="8" y="2" width="8" height="20" rx="2" strokeWidth="2"/>
          <line x1="12" y1="18" x2="12" y2="18" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      );
  }
};

const StatusIcon: React.FC<{ status: PreviewStatus; className?: string }> = ({ status, className = '' }) => {
  switch (status) {
    case 'loading':
      return (
        <svg className={`animate-spin ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth="2" stroke="currentColor" fill="none"/>
          <path 
            d="M12 2a10 10 0 0 1 0 20" 
            strokeWidth="2" 
            stroke="currentColor" 
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'ready':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth="2"/>
          <path d="M9 12l2 2 4-4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case 'error':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" strokeWidth="2"/>
          <line x1="12" y1="8" x2="12" y2="12" strokeWidth="2" strokeLinecap="round"/>
          <line x1="12" y1="16" x2="12" y2="16" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      );
  }
};

export function PreviewControls({
  activeViewport,
  onViewportChange,
  onRefresh,
  isRefreshing,
  status,
}: PreviewControlsProps) {
  const getStatusText = (): string => {
    switch (status) {
      case 'loading':
        return 'Loading...';
      case 'ready':
        return 'Ready';
      case 'error':
        return 'Error';
    }
  };

  const getStatusColor = (): string => {
    switch (status) {
      case 'loading':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'ready':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'error':
        return 'bg-red-50 text-red-700 border-red-200';
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
      <div className="flex items-center space-x-4">
        {/* Viewport Switcher */}
        <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
          {(Object.keys(VIEWPORT_LABELS) as ViewportClass[]).map((viewport) => {
            const dimensions = VIEWPORT_DIMENSIONS[viewport];
            
            return (
              <button
                key={viewport}
                onClick={() => onViewportChange(viewport)}
                className={`flex items-center space-x-2 h-8 px-3 rounded-md text-xs font-medium transition-colors ${
                  activeViewport === viewport
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <ViewportIcon type={viewport} className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {VIEWPORT_LABELS[viewport]}
                </span>
                <span className="hidden md:inline text-gray-500">
                  {dimensions.width}×{dimensions.height}
                </span>
              </button>
            );
          })}
        </div>

        {/* Status Badge */}
        <div className={`flex items-center space-x-1 px-3 py-1 rounded-full border text-xs font-medium ${getStatusColor()}`}>
          <StatusIcon status={status} className="h-3 w-3" />
          <span>{getStatusText()}</span>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
            isRefreshing
              ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          <svg 
            className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeWidth="2" 
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );
}

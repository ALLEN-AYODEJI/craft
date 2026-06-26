# Preview Workspace Design

## Overview

The Preview Workspace provides users with real-time preview capabilities for their customizations across different viewport sizes. It includes an iframe region, controls bar, loading states, and failure recovery layouts.

## Architecture

### Components

#### 1. PreviewWorkspace
The main container component that orchestrates the preview experience.

**Props:**
- `templateId?: string` - Optional template identifier
- `customization?: CustomizationConfig` - Current customization configuration
- `className?: string` - Additional CSS classes

**Features:**
- Manages viewport state (desktop, tablet, mobile)
- Handles loading and error states
- Coordinates between controls and iframe
- Provides refresh functionality

#### 2. PreviewControls
Control bar for preview management and viewport switching.

**Features:**
- **Viewport Switcher**: Toggle between desktop (1440×900), tablet (768×1024), and mobile (375×812)
- **Status Badge**: Shows current preview state (loading, ready, error) with appropriate colors
- **Refresh Button**: Manual preview refresh with loading state

**Visual Design:**
- Clean, modern interface with Tailwind CSS
- Responsive design that adapts to different screen sizes
- Clear visual feedback for user interactions

#### 3. PreviewIframe
Secure iframe container for rendering preview content.

**Security Features:**
- `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`
- Proper CSP headers
- Secure origin validation

**Features:**
- Responsive sizing based on viewport
- Loading overlay with spinner
- Viewport label overlay
- Error boundary handling

#### 4. usePreviewService Hook
Custom hook for managing preview data and state.

**API:**
```typescript
interface UsePreviewServiceReturn {
  generatePreview: (customization: CustomizationConfig, viewport: ViewportClass) => Promise<PreviewData>;
  refreshPreview: (customization: CustomizationConfig, viewport: ViewportClass) => Promise<PreviewData>;
  isLoading: boolean;
  error: string | null;
}
```

## Viewport System

### Supported Viewports

| Viewport | Width | Height | Use Case |
|----------|-------|--------|----------|
| Desktop | 1440px | 900px | Desktop web applications |
| Tablet | 768px | 1024px | Tablet portrait mode |
| Mobile | 375px | 812px | Mobile phone portrait |

### Viewport Switching Behavior

1. **Initial State**: Defaults to desktop viewport
2. **Switching**: Click viewport buttons to change preview
3. **Loading**: Shows loading state during viewport change
4. **Error Recovery**: Maintains selected viewport on error

## Status Communication

### Preview States

| State | Visual Indicator | Color | User Action |
|-------|------------------|-------|-------------|
| Loading | Spinning icon | Blue | Wait for completion |
| Ready | Checkmark | Green | Preview is interactive |
| Error | Exclamation mark | Red | Click retry button |

### Error Handling

**Error Types:**
- Network failures
- Invalid customization data
- Template rendering errors
- Iframe loading failures

**Recovery Strategies:**
- Automatic retry on transient errors
- Manual retry button for persistent errors
- Graceful fallback to last known good state
- Clear error messaging with actionable guidance

## Security Considerations

### Iframe Security

```typescript
// Secure iframe configuration
<iframe
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  loading="lazy"
  title={`Preview for ${viewport} viewport`}
  aria-label={`Preview of template ${templateId} in ${viewport} mode`}
/>
```

### Data Validation

- Input sanitization for customization data
- Template ID validation
- Viewport parameter validation
- XSS prevention in rendered content

## Usage Examples

### Basic Implementation

```typescript
import { PreviewWorkspace } from '@/components/app/preview';

function TemplateEditor() {
  const [customization, setCustomization] = useState<CustomizationConfig>();
  
  return (
    <div className="flex h-screen">
      <div className="w-80 bg-gray-100 p-4">
        {/* Editor controls */}
      </div>
      <div className="flex-1">
        <PreviewWorkspace
          templateId="my-template"
          customization={customization}
          className="h-full"
        />
      </div>
    </div>
  );
}
```

## Testing

The preview components include comprehensive test coverage:

- Unit tests for individual components
- Integration tests for viewport switching
- Error handling and recovery tests
- Accessibility tests

Run tests with:
```bash
npm test -- PreviewWorkspace
```

# LoadingPlaceholder Primitive

Reusable loading placeholder component for ProseMirror and canvas nodes. Lives outside the document schema – never part of saved content.

## What it is

A factory function that creates loading spinner UI for indicating async content loading state. Used for lazy-loaded canvas nodes, deferred editor initialization, and other async operations.

**Key features:**
- Not a document node (no NodeSpec)
- Completely generic - no knowledge of specific content types
- Configurable size variants (small, medium, large)
- Optional overlay with backdrop blur
- Light and dark theme support
- Error state variant with retry button
- Returns `{dom, show, hide, destroy}`

## Architecture

The loadingPlaceholder is a **stateless UI component**:
- **Container** (`.loading-placeholder`): Positioned container with optional overlay
- **Loader** (`.loader`): Animated dual-ring spinner element
- **Error State** (`.error-state`): Error message with retry button

## Usage

### Basic Usage

```typescript
import { createLoadingPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'

// Create with defaults
const placeholder = createLoadingPlaceholder()
container.appendChild(placeholder.dom)

// When content loads
placeholder.destroy()
```

### With Configuration

```typescript
const placeholder = createLoadingPlaceholder({
    size: 'large',           // 'small' | 'medium' | 'large'
    withOverlay: true,       // Show backdrop blur overlay
    theme: 'dark',           // 'light' | 'dark'
    className: 'my-spinner'  // Additional CSS class
})
```

### Error State

```typescript
import { createErrorPlaceholder } from '$src/components/proseMirror/plugins/primitives/loadingPlaceholder/index.ts'

const errorPlaceholder = createErrorPlaceholder({
    message: 'Failed to load document',
    retryLabel: 'Try Again',
    onRetry: () => {
        errorPlaceholder.destroy()
        fetchContent()
    },
    theme: 'light'
})
container.appendChild(errorPlaceholder.dom)
```

## API

### `createLoadingPlaceholder(config?)`

```typescript
createLoadingPlaceholder({
    size?: 'small' | 'medium' | 'large',  // Default: 'medium'
    withOverlay?: boolean,                 // Default: true
    theme?: 'light' | 'dark',              // Default: 'light'
    className?: string                     // Default: ''
})
```

Returns:
- `dom: HTMLElement` - The placeholder element
- `show(): void` - Make placeholder visible
- `hide(): void` - Hide placeholder (display: none)
- `destroy(): void` - Remove from DOM

### `createErrorPlaceholder(config?)`

```typescript
createErrorPlaceholder({
    message?: string,           // Default: 'Failed to load content'
    retryLabel?: string,        // Default: 'Retry'
    onRetry?: () => void,       // Callback when retry button clicked
    withOverlay?: boolean,      // Default: true
    theme?: 'light' | 'dark',   // Default: 'light'
    className?: string          // Default: ''
})
```

Returns:
- `dom: HTMLElement` - The error placeholder element
- `show(): void` - Make placeholder visible
- `hide(): void` - Hide placeholder (display: none)
- `setMessage(message: string): void` - Update error message
- `destroy(): void` - Remove from DOM and cleanup event listeners

## Styling

### Size Variants

| Size   | Dimensions |
|--------|------------|
| small  | 24px       |
| medium | 40px       |
| large  | 60px       |

### Theming

The component uses SCSS mixins for full customization. Override via `_loadingPlaceholder-mixins.scss`:

```scss
@include loadingPlaceholder((
    primaryColor: $nightBlue,
    secondaryColor: $redPink,
    overlayBgLight: rgba(255, 255, 255, 0.85),
    overlayBgDark: rgba(0, 0, 0, 0.65),
    overlayBlur: 6px,
    borderWidth: 4px,
    zIndex: 99,
    // Error state theming
    errorTextColor: #dc2626,
    errorTextColorDark: #fca5a5,
    retryBgColor: $nightBlue,
    retryTextColor: #ffffff
));
```

## Use Cases

1. **Canvas Node Lazy Loading**: Display while fetching document/thread content
2. **Editor Initialization**: Show during ProseMirror instantiation
3. **Image Loading**: Placeholder while images load
4. **API Requests**: Overlay during async operations
5. **Error Recovery**: Show error state with retry on fetch failure

## File Structure

```
loadingPlaceholder/
├── index.ts                      # Export factory
├── pureLoadingPlaceholder.ts     # DOM creation with html template
├── loadingPlaceholder.scss       # Styles with mixin application
├── _loadingPlaceholder-mixins.scss  # Reusable SCSS mixins
└── README.md                     # This file
```

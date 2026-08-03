# Toggle Switch Component

Interactive SVG toggle switch component for reusable D3-backed controls.

## What it is

A D3-based toggle switch renderer that creates SVG toggle elements with built-in state management, smooth animations, and event handling. It is a UI control and is no longer owned by the infographic shape directory.

**Key features:**
- SVG-native rendering (no foreignObject)
- Pill-shaped track with sliding knob
- Built-in hover effects and smooth transitions
- Active/inactive states with checkmark icon
- Disabled state support
- Event bubbling via onChange callback
- Consistent styling with connector system

## Architecture

The toggle switch is rendered as an SVG group containing:
- **Track** (`.toggle-track`): Pill-shaped rounded rectangle background
- **Knob** (`.toggle-knob`): Circular slider that moves left/right
- **Checkmark** (`.toggle-checkmark`): Icon that appears inside knob when active
- **Group** (`.toggle-switch-group`): Container with transform for positioning

## API

### `createToggleSwitch(parent, config)`

Creates and renders a toggle switch within a D3 SVG selection.

**Parameters:**
- `parent` - D3 selection of an SVG element (typically a `<g>`)
- `config` - Configuration object

**Config properties:**
```typescript
{
    id: string              // Unique identifier
    x: number              // X position (left edge of track)
    y: number              // Y position (top edge of track)
    width?: number         // Track width in pixels
    height?: number        // Track height in pixels
    size?: number          // Height alias in pixels when height is omitted (default: 24, width is ~1.8x)
    checked?: boolean      // Initial state (default: false)
    disabled?: boolean     // Disabled state (default: false)
    className?: string     // Additional CSS classes
    onChange?: (checked: boolean, id: string) => void  // State change callback
}
```

**Returns:** `ToggleSwitchInstance`
```typescript
{
    render: () => void
    setChecked: (checked: boolean) => void
    setDisabled: (disabled: boolean) => void
    getChecked: () => boolean
    destroy: () => void
}
```

## Usage Example

```typescript
import { select } from 'd3-selection'
import { createToggleSwitch } from '$src/components/toggleSwitch/index.ts'

const svg = select('svg')
const g = svg.append('g')

const toggleSwitch = createToggleSwitch(g, {
    id: 'thread-1',
    x: 10,
    y: 50,
    width: 30,
    height: 18,
    checked: false,
    onChange: (checked, id) => {
        console.log(`Toggle ${id}: ${checked}`)
    }
})

// Later: update programmatically
toggleSwitch.setChecked(true)

// Cleanup
toggleSwitch.destroy()
```

## Dimensions

The toggle switch uses explicit `width`/`height` when supplied. If `height` is omitted, `size` is used as the track height. If `width` is omitted, width is derived from height.

- **Height**: `height ?? size`
- **Width**: `width ?? height * 1.8`
- **Knob radius**: `height * 0.7 / 2`
- **Track radius**: `height / 2`

## Animations

### Entrance Animation
- Duration: 50ms
- Easing: `easeCubicIn`
- Effect: Slides in from 30px left + fade in

### State Transitions
- Duration: 200ms
- Easing: `easeCubicOut`
- Animated properties:
  - Track fill color
  - Track stroke color
  - Knob position (cx)
  - Checkmark opacity and position

### Hover Effects
- Instant color changes (no transition)
- Brightens track fill on hover

## AI Chat Panel Integration

The workspace AI Chat panel does not use this component. It uses explicit context chips in the composer. Use `toggleSwitch` for generic binary SVG controls only.


## Implementation Notes

- Checkmark uses the global `checkMarkIcon` SVG and scales from its declared viewBox to fit within the knob
- All positioning uses D3 attributes (not CSS)
- Event handlers are re-attached when disabled state changes
- Supports multiple instances with unique IDs via `data-toggle-switch-id` attribute

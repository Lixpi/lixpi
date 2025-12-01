# Checkbox Shape Primitive

Interactive SVG checkbox component for use in infographic visualizations.

## What it is

A D3-based checkbox renderer that creates SVG checkbox elements with built-in state management and event handling. Designed to be embedded in larger SVG visualizations like the contextSelector.

**Key features:**
- SVG-native rendering (no foreignObject)
- Built-in hover effects
- Checked/unchecked states with smooth transitions
- Disabled state support
- Event bubbling via onChange callback
- Consistent styling with connector system

## Architecture

The checkbox is rendered as an SVG group containing:
- **Box** (`.checkbox-box`): Rounded rectangle container with stroke that changes based on state
- **Checkmark** (`.checkbox-checkmark`): SVG path that appears when checked
- **Group** (`.checkbox-group`): Container with transform for positioning

## Visual States

| State | Box Stroke | Checkmark Opacity |
|-------|------------|-------------------|
| Unchecked | `rgba(255, 255, 255, 0.18)` | 0 |
| Checked | `rgba(96, 165, 250, 0.95)` | 1 |
| Disabled | Same as above @ 0.4 opacity | Same as above @ 0.4 opacity |

## API

### `createCheckbox(parent, config)`

Creates and renders a checkbox in the given D3 selection.

```typescript
import { createCheckbox } from './primitives/infographics/shapes/checkbox'

const checkbox = createCheckbox(svgGroup, {
  id: 'thread-1',
  x: 10,
  y: 20,
  size: 24,                    // Optional, default: 24
  checked: false,              // Optional, default: false
  disabled: false,             // Optional, default: false
  className: 'my-checkbox',    // Optional, default: ''
  onChange: (checked, id) => {
    console.log(`Checkbox ${id} is now ${checked ? 'checked' : 'unchecked'}`)
  }
})

// Returns:
// {
//   render: () => void,           // Re-render with current state
//   setChecked: (checked) => void, // Update checked state
//   setDisabled: (disabled) => void, // Update disabled state
//   getChecked: () => boolean,    // Get current checked state
//   destroy: () => void           // Remove from DOM
// }
```

### Configuration

- `id`: Unique identifier for this checkbox (passed to onChange)
- `x`, `y`: Position in SVG coordinates
- `size`: Checkbox size in pixels (default: 24)
- `checked`: Initial checked state (default: false)
- `disabled`: Whether checkbox is interactive (default: false)
- `className`: Additional CSS class for the group element
- `onChange`: Callback fired when checkbox is clicked `(checked: boolean, id: string) => void`

### Methods

- `render()`: Force re-render with current state
- `setChecked(checked: boolean)`: Programmatically set checked state
- `setDisabled(disabled: boolean)`: Programmatically set disabled state
- `getChecked()`: Get current checked state
- `destroy()`: Remove checkbox from DOM

## Usage Example

```typescript
import { select } from 'd3-selection'
import { createCheckbox } from './primitives/infographics/shapes/checkbox'

const svg = select('#my-svg')
const g = svg.append('g')

// Create checkbox
const checkbox = createCheckbox(g, {
  id: 'thread-1',
  x: 50,
  y: 100,
  checked: true,
  onChange: (checked, id) => {
    // Update your application state
    updateThreadSelection(id, checked)
  }
})

// Later: update state programmatically
checkbox.setChecked(false)

// Cleanup
checkbox.destroy()
```

## Styling

The checkbox uses the connector system's color palette:
- **Unchecked stroke**: `rgba(255, 255, 255, 0.18)` (subtle white)
- **Checked stroke**: `rgba(96, 165, 250, 0.95)` (blue-400)
- **Checkmark**: `rgba(96, 165, 250, 0.95)` (blue-400)
- **Background**: `rgba(19, 26, 41, 0.88)` (dark blue, matches connector nodes)

Hover effects brighten the stroke slightly when not disabled.

## Design Decisions

**Why SVG and not HTML checkbox?**
- Consistent rendering across all browsers
- No foreignObject overhead
- Direct integration with D3 visualizations
- Precise control over appearance and animations

**Why emit events instead of managing state internally?**
- Parent component (contextSelector) needs to update ProseMirror document
- Allows for centralized state management
- Enables undo/redo support via ProseMirror transactions

**Why D3 instead of vanilla DOM?**
- Consistent with other visualization primitives
- Leverages D3's event handling and selection APIs
- Easier integration with existing connector/infographic code

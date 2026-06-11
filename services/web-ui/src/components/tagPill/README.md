# Tag Pill Component

Reusable SVG/D3 pill primitive for compact labels, context tags, and closeable chip-like UI. It renders into a caller-provided d3 SVG selection and owns only its SVG group, geometry, hover state, and optional close action.

## API

### `createTagPill(parent, config)`

Appends one SVG group to a d3 selection.

```typescript
{
    id: string
    x: number
    y: number
    width?: number
    height?: number
    size?: number
    minWidth?: number
    fontSize?: number
    fontWeight?: number
    horizontalPadding?: number
    closeSize?: number
    closeIconSize?: number
    closeGap?: number
    textWidthFactor?: number
    label: string
    selected?: boolean
    hovered?: boolean
    disabled?: boolean
    closable?: boolean
    variant?: 'neutral' | 'explicit' | 'auto'
    surface?: 'pill' | 'content'
    closeVisibility?: 'always' | 'hover'
    labelAlign?: 'start' | 'center'
    closePlacement?: 'start' | 'end'
    className?: string
    closeAriaLabel?: string
    onClick?: (id: string, event: Event) => void
    onClose?: (id: string, event: Event) => void
}
```

Returns `{ render, resize, setSelected, destroy }`.

## Behavior

- Renders SVG only: `g`, `rect`, `text`, `circle`, and icon paths.
- Uses numeric D3 attributes for geometry, colors, hover state, and close icon placement.
- Accepts pixel sizing controls for height (`height` or legacy-style `size`), typography, horizontal padding, close target size, close icon size, close gap, and auto-width estimation.
- Defaults use the same compact primitive geometry as the AI chat tabs: 24px tall segment, 96px minimum width, regular 12px text, centered labels, a subtle active border, and the close icon on the left.
- If `width` is omitted, the pill sizes to the rendered label and close control, clamped to the tab-style minimum width. Labels are never truncated.
- Auto-sized width is stable across hover/selected-only renders; hover may change paint and close visibility, but not layout geometry.
- `surface: 'content'` keeps the selected background transparent so another component can own the selected surface, while inactive hover paints a very light grey background.
- Closeable pills show the close control by default; `closeVisibility: 'hover'` keeps the close control hidden until hover for tab strips.
- `closePlacement: 'start'` renders the close control on the left side of the pill.
- Keeps close behavior local: close clicks stop propagation and call `onClose(id, event)`.
- `render(state)` updates label, selected/hovered/disabled state, close visibility, variant, and dimensions.
- `destroy()` removes the mounted group and leaves the caller-owned SVG untouched.

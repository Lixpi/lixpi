# Sliding Tabs Switch Component

Tab-specific SVG/D3 switch that composes [`slidingSwitch`](../slidingSwitch/README.md) with [`tagPill`](../tagPill/README.md). The sliding switch owns the track, moving indicator, selected value, keyboard behavior, and close callbacks. The tag pill renderer owns each tab's label and close control.

## API

### `createSlidingTabsSwitch(parent, config)`

Appends one SVG group through `slidingSwitch`.

```typescript
{
    id: string
    x: number
    y: number
    width: number
    height?: number
    tabs: {
        label: string
        value: Value
        closable?: boolean
        disabled?: boolean
        ariaLabel?: string
        closeAriaLabel?: string
    }[]
    selectedValue?: Value
    className?: string
    minTabWidth?: number
    transition?: {
        durationMs?: number
        minDurationMs?: number
        distanceSpeedupFactor?: number
    }
    activeTabBoxShadow?: string
    activeTabInsetShadow?: {
        topColor: string
        bottomColor: string
    }
    onChange?: (value: Value, id: string) => void
    onClose?: (value: Value, id: string, tab) => void
}
```

Returns the underlying sliding switch instance: `{ render, resize, setValue, getValue, getContentWidth, getOuterHeight, destroy }`.

## Behavior

- Renders with SVG only.
- Uses `role="tablist"` on the switch and `role="tab"` on each tab option.
- Keeps the moving indicator as the only selected-tab surface, with no active-tab border.
- Uses the flat white active indicator owned by `slidingSwitch` when no appearance overrides are supplied.
- Forwards explicit `activeTabBoxShadow` and `activeTabInsetShadow` customization to the underlying switch for reusable consumers. Lixpi application callsites use the defaults.
- Renders centered regular-weight tab labels through `tagPill` in content mode so inactive tabs only paint a very light hover background.
- Shows each tab close control on the left only while that tab is hovered.
- Passes slide transition timing through to `slidingSwitch`.
- The host passes the visible tab strip width. `slidingSwitch` applies `minTabWidth`, computes the scrollable content width, and updates the SVG host on resize.

# Slider Component

`slider` is a reusable, domain-agnostic D3 SVG control for choosing one value from an ordered set. It renders a continuous rail, active progress, a draggable thumb, and a value bubble above the thumb. The component owns SVG rendering and pointer/keyboard interaction; the consumer owns the selected value.

## API

`createSlider(parent, config)` appends one SVG `<g>` to a caller-provided D3 selection.

```typescript
const slider = createSlider(svg, {
    id: 'duration',
    x: 0,
    y: 0,
    width: 320,
    options: [
        { value: '4', label: '4s' },
        { value: '6', label: '6s' },
        { value: '8', label: '8s' },
    ],
    selectedValue: '6',
    onChange: (value) => persist(value),
})
```

The returned instance exposes `render()`, `resize(x, y, width, height?)`, `setValue(value)`, `getValue()`, and `destroy()`.

## Behavior

- Pointer down selects the nearest enabled value; dragging snaps the thumb across the ordered values.
- Arrow keys move by one value. Home and End select the first and last values.
- `setValue()` updates without firing `onChange`; pointer and keyboard changes fire it once per changed value.
- The value bubble sizes to the selected label, so special values such as `Smart length` use the same control.
- Parent width observation is enabled by default. `destroy()` disconnects observation, removes global drag listeners, interrupts transitions, and removes the mounted SVG group.

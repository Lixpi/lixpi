# Sliding Switch Component

A reusable, domain-agnostic SVG sliding single-select, built with the same approach as [`toggleSwitch`](../toggleSwitch/README.md): it renders into a provided d3 SVG selection and animates numeric attributes. It shows any number of options with one selected at a time and a sliding indicator behind the active option. There is **no stylesheet** — track, indicator, labels, hover, and the slide animation are all done in SVG via d3.

## API

### `createSlidingSwitch(parent, config)`

Appends an SVG group to a d3 selection of an SVG element.

**Config:**
```typescript
{
    id: string
    x: number
    y: number
    width: number                       // overall width in SVG user units
    height?: number                     // default 26
    options: { label: string; value: Value }[]
    selectedValue?: Value               // defaults to the first option
    className?: string
    onChange?: (value: Value, id: string) => void
}
```

**Returns:** `{ render, setValue, getValue, destroy }`

## Usage

```typescript
import { select } from 'd3-selection'
import { createSlidingSwitch } from '$src/components/slidingSwitch/index.ts'

const svg = select('svg')
const slidingSwitch = createSlidingSwitch(svg, {
    id: 'view-mode',
    x: 0,
    y: 0,
    width: 120,
    options: [
        { label: 'List', value: 'list' },
        { label: 'Grid', value: 'grid' },
        { label: 'Timeline', value: 'timeline' },
    ],
    selectedValue: 'grid',
    onChange: (value, id) => {
        // Persist the selected value in the owning feature.
    },
})

slidingSwitch.setValue('timeline')   // programmatic select, does not fire onChange
slidingSwitch.getValue()             // 'timeline'
slidingSwitch.destroy()
```

## Behavior

- Renders an SVG track, a sliding indicator, and one centered text label + transparent hit area per option.
- The indicator slides to the active option via a d3 transition on its `x` attribute (numeric — no CSS, no transform parsing).
- Click selects an option and fires `onChange(value, id)`; hovering a non-active label highlights it via d3 handlers.
- The consumer owns the host `<svg>` (size it via its own styles) and the meaning of each value.

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
    options: {
        label: string
        value: Value
        closable?: boolean
        disabled?: boolean
        ariaLabel?: string
        closeAriaLabel?: string
    }[]
    selectedValue?: Value               // defaults to the first option
    className?: string
    role?: string                       // default radiogroup
    optionRole?: string                 // default radio
    selectedAriaAttribute?: 'aria-checked' | 'aria-selected'
    minOptionWidth?: number             // content width grows past host width when needed
    observeParentResize?: boolean       // default true when minOptionWidth is provided
    visualOverflowPadding?: {
        top?: number
        right?: number
        bottom?: number
        left?: number
    }
    indicatorBoxShadow?: string         // applied as an SVG drop-shadow filter to the active segment
    indicatorInsetShadow?: {
        topColor: string
        bottomColor: string
    }
    renderOption?: (parent, state) => SlidingSwitchOptionRenderInstance | void
    onChange?: (value: Value, id: string) => void
    onClose?: (value: Value, id: string, option) => void
}
```

**Returns:** `{ render, resize, setValue, getValue, getContentWidth, getOuterHeight, destroy }`

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

### Custom option rendering

`renderOption` lets a host render each segment with another D3 SVG primitive while `slidingSwitch` keeps ownership of selection, keyboard navigation, the sliding indicator, and close callbacks. The callback receives the option geometry and state plus an `onClose(event)` helper. A custom renderer should append inside the provided segment group and return an object with an optional `render(state)` method.

```typescript
import { createTagPill } from '$src/components/tagPill/index.ts'

createSlidingSwitch(svg, {
    id: 'chat-tabs',
    x: 0,
    y: 0,
    width: 304,
    height: 28,
    role: 'tablist',
    optionRole: 'tab',
    selectedAriaAttribute: 'aria-selected',
    options: tabs.map((tab) => ({ label: tab.title, value: tab.id, closable: true })),
    renderOption: (parent, state) => createTagPill(parent, {
        id: state.id,
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
        label: state.option.label,
        selected: state.selected,
        hovered: state.hovered,
        closable: state.closable,
        surface: 'content',
        closeVisibility: 'hover',
        labelAlign: 'center',
        onClose: (_id, event) => state.onClose(event),
    }),
})
```

## Behavior

- Renders an SVG track, a sliding indicator, and one centered text label + transparent hit area per option by default.
- The indicator slides to the active option via a d3 transition on its `x` attribute (numeric — no CSS, no transform parsing).
- The indicator does not render a stroke; callers can add elevation with `indicatorBoxShadow` and an inset highlight/shade with `indicatorInsetShadow`.
- When `indicatorBoxShadow` is set, the component adds top and side SVG padding for the active indicator shadow while clipping bottom overflow.
- `resize(x, y, width, height)` treats `width` as the visible viewport width. If `minOptionWidth` is set, the switch computes a larger scrollable content width internally.
- When mounted directly into an `<svg>`, the switch updates that SVG's `width`, `height`, `viewBox`, and visible overflow on initial render and resize.
- Click selects an option and fires `onChange(value, id)`; hovering a non-active label highlights it via d3 handlers.
- `Enter`, `Space`, arrow keys, `Home`, and `End` update selection from the focused segment.
- Closable options render the close button on the left on hover and call `onClose(value, id, option)` without changing selection.
- Custom renderers inherit selection, hover, disabled, geometry, and close state through their `render(state)` method.
- The consumer owns the meaning of each value. If the parent selection is not an `<svg>` root, the consumer remains responsible for sizing the outer SVG.

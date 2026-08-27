# Sliding Dropdown Component

`slidingDropdown` is a compact SVG/D3 single-select. The closed control shows one row inside the same track and indicator treatment as `slidingSwitch`, with a separate chevron to its right. The component owns its overlay geometry. Opening never changes the mount's layout height or extends a clipping ancestor's scrollable area.

## API

### `createSlidingDropdown(parent, config)`

The component appends one SVG group to a caller-provided root SVG selection. The caller owns the selected value's meaning. While open, the component portals the root SVG into a fixed body scroll surface, preserves the host's rendered scale, and keeps its original host as the closed-size layout placeholder. The native scroll surface supplies cross-browser gesture completion through `scrollend`; the visible control remains SVG/D3 and the surface never clips the moving tape. The component restores the SVG when closing completes and restores the original inline styles and SVG attributes in `destroy()`.

```typescript
const dropdown = createSlidingDropdown(svg, {
    id: 'quality',
    x: 0,
    y: 0,
    options: [
        { label: 'Standard', value: 'standard' },
        { label: 'High', value: 'high' },
        { label: 'Ultra', value: 'ultra' },
    ],
    selectedValue: 'standard',
    onChange: value => persistValue(value),
})
```

The default row height is 66 units, and the default initial measurement width is 156 units. A closed surface uses the measured right edge of its selected option. Opening animates the surface to the longest measured option without keeping unused space from the initial width. The separate chevron uses 18 units with a 2-unit gap. `optionHorizontalPadding` controls the space between content and the indicator edge, and defaults to 12 units per side. The component includes indicator stroke width in those insets and gives every option a stable intrinsic layout width, so its content does not move horizontally while the surface opens or closes. The config accepts the same option, custom option renderer, indicator shadow, and overflow padding shapes as `slidingSwitch`. Its transition config adds `snapDurationMs` to the shared `durationMs`, `minDurationMs`, and `distanceSpeedupFactor` fields. `ariaLabel` names the control, and `observeParentResize` constrains both intrinsic widths so the full control fits the available parent width.

The component reads its surface backgrounds, indicator background and state-specific borders, indicator shadows, option colors and typography, and expanded shadow from `uiKitSettings.slidingDropdown.styles`. The configured closed surface is transparent and the closed indicator border width is zero. The configured open indicator border is rendered around the selected row. Intrinsic width includes the larger configured indicator border, so enabling either border does not reduce the content padding or collide with the chevron. The chevron remains outside the selected-row indicator and the expanded tape. It points down while closed and rotates 90 degrees clockwise while open, so it points toward the tape. While the native scroll surface is open, the chevron moves into a separate fixed SVG overlay instead of moving with the scrollable SVG. The expanded shadow starts with the opening viewport transition and is removed on the first closing frame, so it cannot remain around the collapsed control. The component does not interpret option values or render domain-specific glyphs. A caller can pass `renderOption(parent, state)` to append custom SVG content for each option. The renderer receives the option value, label, geometry, selected state, hover state, disabled state, and resolved option color. It can return `resize`, `render`, and `destroy` lifecycle methods.

The returned instance exposes `render`, `resize`, `setValue`, `getValue`, `setOpen`, `isOpen`, `getOuterHeight`, and `destroy`. Programmatic `setValue` does not call `onChange`.

## Interaction

- Click the selected row or chevron, press Enter or Space, or press an arrow key to open the list. Clicking the chevron again closes the list and applies the pending row.
- Option rows always retain their source order and source positions.
- The open overlay always follows the tape's full natural extent. Its bounds travel with the tape while the indicator stays fixed at the closed control's position, so opening on any selected value and moving in either direction never clips an option at the tape's top or bottom.
- The grey track and its option content form one ordered tape. Wheel, trackpad, pointer drag, Arrow, Home, and End input move the entire tape through the fixed selection area without scrolling the parent.
- Wheel and trackpad input use the portaled native scroll surface. Snapping starts on its `scrollend` event, after the browser reports that scrolling, momentum, and the physical gesture have ended. A stationary finger still touching a trackpad therefore does not release the tape. Pointer dragging snaps on `pointerup`.
- An ordinary pointer press remains an option click. Pointer capture starts only after movement crosses the drag threshold.
- Click a row to slide the tape behind the fixed indicator while the viewport closes around that stationary frame, then apply it as the selected value.
- Wheel, trackpad, drag, and keyboard movement update the pending row. Closing with Escape, an outside press, or `setOpen(false)` aligns and applies that row.
- Arrow keys move focus through enabled rows while the list is open. Home and End focus the first and last enabled rows.
- The component exposes combobox, listbox, option, expanded, selected, and disabled ARIA state.

All D3 motion uses `easePupOut` from `src/animation/easings.ts`. The selected indicator is a stationary frame: opening and closing never animate its position. The surface, option rows, fixed overlay, and chevron position animate through the same width change, while the chevron rotates with the opening and closing transition. The layout host anchors its left edge and keeps the closed selected-value width while the SVG is portaled, so a wider expanded tape or a different selected-value width cannot move the selected content on screen. The portaled root SVG also keeps one stable full-tape height throughout those transitions. Opening expands the tape viewport around the frame while growing to the expanded intrinsic width. Closing translates the tape behind the frame while the viewport and width contract to the selected option, then restores the closed root SVG after the transition. Opening uses 200 ms, the close timing floor is 70 ms, and scroll snapping uses 50 ms. A clicked selection keeps its existing 2× multiplier and uses one concurrent slide-and-collapse transition at twice the longer of its distance-adjusted travel timing and the 70 ms close timing. The component owns its SVG group, fixed chevron overlay, native scroll surface, host and root-SVG presentation while mounted, ResizeObserver, document listener, transitions, and animation timers. `destroy()` removes its group and restores the caller-owned host and SVG.

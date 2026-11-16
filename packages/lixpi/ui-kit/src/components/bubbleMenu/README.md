# Bubble Menu (Core)

Framework-agnostic floating menu component used for context-sensitive actions on selected elements. Think of it as a reusable toolbar that appears next to whatever the user has selected — text in an editor, an image in a document, or a node on a canvas.

## Architecture

The core `BubbleMenu` class handles:

- **DOM lifecycle**: Creates `div.bubble-menu > div.bubble-menu-content`, mounts items, manages panels
- **Context switching**: Shows/hides items based on string-keyed contexts (e.g., `'text'`, `'image'`, `'canvasImage'`)
- **Transform-aware positioning**: Works correctly inside CSS-transformed ancestors (zoom/pan viewports)
- **Optional visual scaling**: Consumers can provide a scale curve for menus that should shrink or grow with a canvas zoom level
- **Show/hide with animation**: CSS transitions via `.is-visible` class
- **Prevent-hide pattern**: `mousedown` + `preventDefault` prevents focus loss when clicking menu buttons
- **Scroll/resize tracking**: Repositions on scroll and mobile viewport resize

Closed menus use `display: none` so the toolbar and its nested dropdowns cannot extend a scroll container beyond its content. Opening restores the menu's display before measuring and positioning it; inline toolbars also restore their normal layout when reopened.

`settings.ts` owns the shared menu's appearance, sizing, motion, and placement defaults. BubbleMenu exposes them to its stylesheet through CSS custom properties. Colors come from the active theme's `control.bubbleMenu` roles, projected as `--theme-bubble-menu-*` properties. The light preset uses the image/video switch's pale blue background, blue selection, and dark icon palette; Mariana supplies its own dark surfaces and light foregrounds. Hovered and selected icons inherit their button's themed state color. A dropdown trigger with a selected value uses the same active background and foreground as that option in the expanded menu; a trigger without a selected value keeps its neutral appearance. Open toolbars and dropdowns resolve these properties against the nearest Lixpi theme scope and follow theme changes. A host overlay can raise the menu through its own stacking rule.

## Consumers

### ProseMirror plugins

The rich-editing `BubbleMenuView` adapts this component for text and image selections:
- Detects selection context (`'text'` or `'image'`) from `EditorView` state
- Computes position requests from ProseMirror coordinates (`coordsAtPos`) or image element rects
- Manages ProseMirror-specific interactions (link input panel, mark toggling, image attribute changes)
- Drives show/hide on every ProseMirror transaction

The shared nested-list editor displays a bare action trigger over the hovered block. Clicking it opens a `BubbleMenu` with insert and block-style dropdowns plus options supplied by the host. Read-only lists do not mount the trigger. Insert and More use vertical `BubbleMenu` instances for the action options. The nested-list and rich-editing text-style selectors both use `BubbleMenuDropdown`.

### Workspace Canvas

The `WorkspaceCanvas` creates a `BubbleMenu` for canvas image nodes:
- Uses `'canvasImage'` context
- Positions below the selected image node element
- Provides Create Variant, Download, and Delete actions
- Shows when an image node is selected, hides on deselection/drag/resize

The chat layout control mounts an inline `BubbleMenu` with a `BubbleMenuDropdown` for the layout options.

## Usage

```typescript
import { BubbleMenu, type BubbleMenuItem } from '@lixpi/ui-kit/components/bubble-menu'
import '@lixpi/ui-kit/styles/bubble-menu'

const items: BubbleMenuItem[] = [
    {
        element: myButtonElement,
        context: ['myContext'],
    },
]

const menu = new BubbleMenu({
    parentEl: document.querySelector('.my-container'),
    items,
    onHide: () => { /* cleanup */ },
})

// Show below target element
menu.show('myContext', {
    targetRect: targetElement.getBoundingClientRect(),
    placement: 'below',
})

// Keep the menu attached even if the target is outside the parent bounds
menu.show('myContext', {
    targetRect: targetElement.getBoundingClientRect(),
    placement: 'below',
    clampToParent: false,
    animateOnShow: false,
})

// Reposition (e.g., on resize events)
menu.reposition()

// Hide
menu.hide()

// Cleanup
menu.destroy()
```

## API

### `BubbleMenu(options: BubbleMenuOptions)`

| Option | Type | Description |
|--------|------|-------------|
| `parentEl` | `HTMLElement` | Where to mount the menu DOM |
| `inline` | `boolean` | Mount in the normal layout and show the first item's context immediately |
| `orientation` | `'horizontal' \| 'vertical'` | Arrange the controls as a row or column in the shared capsule |
| `role` | `'toolbar' \| 'menu'` | Accessible role for the controls |
| `getScale` | `() => number` | Optional coordinate scale when the host already knows its transform |
| `items` | `BubbleMenuItem[]` | All menu items with context arrays |
| `panels` | `HTMLElement[]` | Optional secondary panels (e.g., link input) |
| `getVisualScale` | `() => number` | Optional visual scale applied through `--bubble-menu-visual-scale` before measuring and positioning |
| `onShow` | `(context: string) => void` | Called when menu becomes visible |
| `onHide` | `() => void` | Called when menu hides |

### Instance Methods

| Method | Description |
|--------|-------------|
| `show(context, position)` | Show menu with given context and target position |
| `hide()` | Hide the menu |
| `forceHide()` | Hide immediately, clearing `preventHide` state |
| `reposition(position?)` | Reposition using new or last-known position; already-visible menus stay visible during measurement so hovered controls keep cursor/hover state |
| `updateContext(context, position)` | Switch context and reposition |
| `refreshState()` | Call each item's `update()` callback |
| `destroy()` | Remove all listeners and DOM |

### Instance Properties

| Property | Type | Description |
|----------|------|-------------|
| `element` | `HTMLElement` | The menu DOM element |
| `isVisible` | `boolean` | Whether the menu is currently shown |
| `context` | `string` | Current active context |
| `preventHide` | `boolean` | Set by `mousedown` handler to prevent hide on blur |

### `BubbleMenuItem`

```typescript
type BubbleMenuItem = {
    element: HTMLElement
    context: string[]
    update?: () => void
    hide?: () => void
    reposition?: () => void
    destroy?: () => void
}
```

### `BubbleMenuPositionRequest`

```typescript
type BubbleMenuPositionRequest = {
    targetRect: DOMRect
    placement: 'above' | 'below' | 'left' | 'right' | 'auto'
    horizontalAlignment?: 'start' | 'center' | 'end'
    bounds?: DOMRect
    gap?: number
    clampToParent?: boolean
    animateOnShow?: boolean
}
```

`placement: 'left'` places the menu to the left of the target, vertically centered. `placement: 'right'` places the menu beside the target, vertically centered on it, as for a menu that belongs to one line of text. With `horizontalAlignment: 'end'` it sits inside the target against its right edge instead.

`clampToParent` defaults to `true`. Canvas-attached or compact-control menus can set it to `false` when the menu should move with the target instead of staying inside the visible parent bounds. For `placement: 'above'`, disabling clamping also disables the automatic below-target flip.

`animateOnShow` defaults to `true`. Anchored canvas menus can set it to `false` when a first-show transform transition would make the menu appear to drift away from its target.

### `BubbleMenuDropdown`

Mount `dropdown.element` as a toolbar item. Pass the owner `document`, a trigger `label`, and icon options with `value` and `label`. A `menuLabel` can name the options separately. An absent value displays the optional `fallbackIcon` and leaves every option unchecked.

The options are a vertical `BubbleMenu` attached to the trigger. It opens below when there is room, flips above when that gives it more space, and scrolls when it cannot fit. Pass `getBounds` to set the vertical space the menu can use and `getScale` if the host already knows its transform. Call `reposition()` when a host moves the trigger without a scroll or resize event.

`setValue(value)` updates the trigger icon and checked option. Only a user choice calls `onChange(value)`. `onOpen()` runs when the dropdown opens. `open()`, `toggle()`, and `hide()` control visibility, and `isOpen` reflects the current state. Wire `hide()`, `reposition()`, and `destroy()` into the enclosing BubbleMenu item when that toolbar owns the dropdown's lifecycle.

## Files

| File | Purpose |
|------|---------|
| `BubbleMenu.ts` | Core class with positioning, show/hide, and context switching |
| `BubbleMenuDropdown.ts` | Icon trigger, checked options, and selection behavior for a vertical BubbleMenu |
| `settings.ts` | Appearance and positioning defaults for the toolbar and its dropdown |
| `types.ts` | Shared types (`BubbleMenuItem`, `BubbleMenuOptions`, `BubbleMenuPositionRequest`) |
| `bubbleMenu.scss` | Styles for menu, buttons, dropdown, link input, separator |
| `index.ts` | Public exports |

## CSS Classes

All styles use the `.bubble-menu-*` prefix and are fully generic:

- `.bubble-menu` — Root container (absolute positioned)
- `.bubble-menu-content` — Flex row of buttons
- `.bubble-menu-button` — Individual icon button
- `.bubble-menu-separator` — Vertical divider
- `.bubble-menu-dropdown` — Dropdown wrapper
- `.bubble-menu-link-input` — Link input panel

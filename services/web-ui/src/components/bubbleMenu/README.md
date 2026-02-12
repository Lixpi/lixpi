# Bubble Menu (Core)

Framework-agnostic floating menu component used for context-sensitive actions on selected elements. Think of it as a reusable toolbar that appears next to whatever the user has selected — text in an editor, an image in a document, or a node on a canvas.

## Architecture

The core `BubbleMenu` class handles:

- **DOM lifecycle**: Creates `div.bubble-menu > div.bubble-menu-content`, mounts items, manages panels
- **Context switching**: Shows/hides items based on string-keyed contexts (e.g., `'text'`, `'image'`, `'canvasImage'`)
- **Transform-aware positioning**: Works correctly inside CSS-transformed ancestors (zoom/pan viewports)
- **Show/hide with animation**: CSS transitions via `.is-visible` class
- **Prevent-hide pattern**: `mousedown` + `preventDefault` prevents focus loss when clicking menu buttons
- **Scroll/resize tracking**: Repositions on scroll and mobile viewport resize

The core does NOT know about ProseMirror, `@xyflow/system`, Svelte, or any specific editor/canvas framework.

## Consumers

### ProseMirror Plugin (`proseMirror/plugins/bubbleMenuPlugin/`)

The `BubbleMenuView` class adapts the core `BubbleMenu` for ProseMirror:
- Detects selection context (`'text'` or `'image'`) from `EditorView` state
- Computes position requests from ProseMirror coordinates (`coordsAtPos`) or image element rects
- Manages ProseMirror-specific interactions (link input panel, mark toggling, image attribute changes)
- Drives show/hide on every ProseMirror transaction

### Workspace Canvas (`infographics/workspace/`)

The `WorkspaceCanvas` creates a `BubbleMenu` for canvas image nodes:
- Uses `'canvasImage'` context
- Positions below the selected image node element
- Provides Create Variant, Download, and Delete actions
- Shows when an image node is selected, hides on deselection/drag/resize

## Usage

```typescript
import { BubbleMenu, type BubbleMenuItem } from '$src/components/bubbleMenu/index.ts'
import '$src/components/bubbleMenu/bubbleMenu.scss'

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
| `items` | `BubbleMenuItem[]` | All menu items with context arrays |
| `panels` | `HTMLElement[]` | Optional secondary panels (e.g., link input) |
| `onShow` | `(context: string) => void` | Called when menu becomes visible |
| `onHide` | `() => void` | Called when menu hides |

### Instance Methods

| Method | Description |
|--------|-------------|
| `show(context, position)` | Show menu with given context and target position |
| `hide()` | Hide the menu |
| `forceHide()` | Hide immediately, clearing `preventHide` state |
| `reposition(position?)` | Reposition using new or last-known position |
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
}
```

### `BubbleMenuPositionRequest`

```typescript
type BubbleMenuPositionRequest = {
    targetRect: DOMRect
    placement: 'above' | 'below'
}
```

## Files

| File | Purpose |
|------|---------|
| `BubbleMenu.ts` | Core class with positioning, show/hide, and context switching |
| `types.ts` | Shared types (`BubbleMenuItem`, `BubbleMenuOptions`, `BubbleMenuPositionRequest`) |
| `bubbleMenu.scss` | Styles for menu, buttons, dropdown, link input, separator |
| `index.ts` | Public exports |

## CSS Classes

All styles use the `.bubble-menu-*` prefix and are fully generic:

- `.bubble-menu` — Root container (absolute positioned)
- `.bubble-menu-content` — Flex row of buttons
- `.bubble-menu-button` — Individual button (28×28, 40×40 on mobile)
- `.bubble-menu-separator` — Vertical divider
- `.bubble-menu-dropdown` — Dropdown wrapper
- `.bubble-menu-link-input` — Link input panel

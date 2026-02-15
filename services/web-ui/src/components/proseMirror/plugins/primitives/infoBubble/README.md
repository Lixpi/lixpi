# InfoBubble Primitive

Generic floating bubble container for ProseMirror NodeViews. Lives outside the document schema – never part of saved content.

## What it is

A factory function that creates floating bubble UI controls with optional header and body sections. **Manages its own state** including open/close, click handling, and mutual exclusion with other bubbles.

**Key features:**
- Not a document node (no NodeSpec)
- Completely generic - no knowledge of specific content types
- **Owns its visibility state and event handling**
- Attaches click handler to provided anchor element
- Handles click-outside-to-close automatically
- **Enforces mutual exclusion** - only one bubble open at a time
- **Auto-repositioning** - tracks content changes, scroll, and resize
- **Smart positioning** - automatically flips arrow side when space is limited
- **Precise alignment** - arrow tip always points to center of positioningAnchor
- Side-aware arrow rendering (top/bottom/left/right)
- Appended directly to your controls container
- Returns `{dom, open, close, toggle, isOpen, destroy}`

## Architecture

The infoBubble is a **stateful interactive component**:
- **Wrapper** (`.bubble-wrapper`): Fixed-positioned container
- **Container** (`.bubble-container`): Main bubble with arrow
- **Header** (`.bubble-header`): Optional top section
- **Body** (`.bubble-body`): Main content area
- **State Manager**: Singleton that ensures only one bubble is open
- **Content Observer**: MutationObserver that repositions on content changes
- **Viewport Listeners**: Repositions on scroll/resize

## Why not document nodes?

Previously, UI controls were ProseMirror document nodes. Problems:
- Rendered in `contentDOM` first, required relocation via `requestAnimationFrame`
- Complex state management via decorations
- Became part of document content (gets serialized)
- NodeView recreated on every interaction

Now: direct DOM append to controls container. Renders instantly where you put it.

## API

### `createInfoBubble(config)`

```typescript
createInfoBubble({
  id: 'unique-id',
  anchor: HTMLElement,                    // NEW: Element that triggers bubble
  positioningAnchor?: HTMLElement,        // NEW: Optional element to position/center against (defaults to anchor)
  theme?: 'dark' | 'light',
  arrowSide?: 'top' | 'bottom' | 'left' | 'right',
  headerContent?: HTMLElement,
  bodyContent: HTMLElement,
  visible?: boolean,
  onOpen?: () => void,                    // NEW: Called when bubble opens
  onClose?: () => void,                   // NEW: Called when bubble closes
  closeOnClickOutside?: boolean,          // NEW: Default true
  disableAutoPositioning?: boolean,       // NEW: Keep bubble position CSS-driven, only arrow alignment updates
  offset?: { x?: number, y?: number },    // NEW: Optional pixel offset applied to computed position
  arrowCrossOffset?: number,              // NEW: Optional distance of arrow from edge (overrides default 8px)
  className?: string
})
// Returns: {
//   dom: HTMLElement,
//   open: () => void,      // NEW: Was show()
//   close: () => void,     // NEW: Was hide()
//   toggle: () => void,    // NEW: Toggle open/close
//   isOpen: () => boolean, // NEW: Check state
//   destroy: () => void
// }
```

### Configuration

- `id`: Unique identifier for this bubble
- **`anchor`**: **REQUIRED** - HTML element that triggers the bubble (e.g., button, icon). Click events are bound to this element.
- **`positioningAnchor`**: Optional element used for positioning/centering the arrow. If provided, the arrow will point to the center of this element while click events remain on `anchor`. Falls back to `anchor` if not provided.
- `theme`: 'dark' or 'light' (default: 'dark')
- `arrowSide`: Arrow direction - 'top', 'bottom', 'left', or 'right' (default: 'top'). **Note**: The bubble automatically flips to the opposite side if there's insufficient space.
- `headerContent`: Optional HTML element for header section
- `bodyContent`: **REQUIRED** - HTML element for body section
- `visible`: Initial visibility state (default: false)
- **`onOpen`**: Callback executed when bubble opens
- **`onClose`**: Callback executed when bubble closes
- **`closeOnClickOutside`**: Whether to close when clicking outside (default: true)
- **`disableAutoPositioning`**: When `true`, skips viewport `top/left` placement, keeps arrow styling unchanged, and shifts the bubble wrapper in CSS space so the arrow tip aligns to `positioningAnchor`.
- **`offset`**: Spacing from anchor in pixels. Defaults to `{ x: 0, y: 20 }`. The `y` value creates spacing in the arrow's direction (e.g., 20px below anchor for `arrowSide='top'`).
- **`arrowCrossOffset`**: Optional distance (in pixels) of the arrow from the bubble's edge. Defaults to `8px` (from CSS). Use this when you have a larger `border-radius` on the bubble to prevent the arrow from visually conflicting with rounded corners. For example, if `border-radius: 10px`, use `arrowCrossOffset: 20` to move the arrow further from the corner.
- `className`: Optional CSS class to add to the wrapper element

### Return Value

- `dom`: HTMLElement to append to your container
- **`open()`**: Open the bubble (closes any other open bubbles)
- **`close()`**: Close the bubble
- **`toggle()`**: Toggle between open/closed
- **`isOpen()`**: Returns boolean indicating current state
- `destroy()`: Clean up event listeners and DOM

### State Manager

The `infoBubbleStateManager` singleton ensures only one bubble is open at a time:

```typescript
import { infoBubbleStateManager } from '$src/components/proseMirror/plugins/primitives/infoBubble/index.ts'

infoBubbleStateManager.closeAll()      // Close all open bubbles
infoBubbleStateManager.isOpen(id)      // Check if specific bubble is open
```

## Positioning Behavior

### Smart Auto-Flip
The bubble automatically flips its arrow side when there's insufficient space:
- `arrowSide='top'` (bubble below anchor) flips to `'bottom'` (bubble above) if no space below
- `arrowSide='bottom'` flips to `'top'` if no space above
- `arrowSide='left'` flips to `'right'` if no space on the right
- `arrowSide='right'` flips to `'left'` if no space on the left

The flip only occurs if the opposite side has sufficient space. If neither side has space, the original side is used.

### Precise Arrow Alignment
The arrow tip **always points to the center** of the `positioningAnchor` element (or `anchor` if `positioningAnchor` is not provided). The entire bubble is positioned so the arrow tip aligns with this center point, regardless of the bubble's size or position.

### Auto-Repositioning
The bubble automatically repositions when:
- **Content changes**: MutationObserver detects DOM changes in the bubble content
- **Scroll events**: Any scrollable ancestor or window scroll (uses capture phase)
- **Resize events**: Window or viewport size changes
- **Anchor movement**: Since position is calculated from anchor's bounding rect, any anchor movement triggers repositioning

This means dropdowns with filtered content automatically reposition without manual intervention.

## Example Usage

### Simple Info Bubble

```typescript
import { createInfoBubble } from '$src/components/proseMirror/plugins/primitives/infoBubble/index.ts'

// Create anchor element
const infoIcon = html`
  <div class="info-icon" innerHTML=${infoIconSvg}></div>
`

// Create bubble
const infoBubble = createInfoBubble({
  id: 'help-tooltip',
  anchor: infoIcon,
  bodyContent: html`<p>Click me for help!</p>`,
  theme: 'dark',
  arrowSide: 'top',
  offset: { x: 0, y: 15 } // 15px below icon
})

// Append both to container
container.appendChild(infoIcon)
container.appendChild(infoBubble.dom)

// InfoBubble handles click on icon automatically!
// Clicking icon toggles bubble
// Clicking outside closes bubble
// Scrolling repositions bubble
```

### Dropdown with Separate Positioning Anchor

```typescript
import { createInfoBubble } from '$src/components/proseMirror/plugins/primitives/infoBubble/index.ts'

// Dropdown button with chevron icon
const button = html`
  <button class="dropdown-button">
    <span class="label">Select Option</span>
    <span class="chevron-icon" innerHTML=${chevronIcon}></span>
  </button>
`

const chevron = button.querySelector('.chevron-icon')

// Create bubble - click on button, but center arrow on chevron
const infoBubble = createInfoBubble({
  id: 'my-dropdown',
  anchor: button,                    // Click binding
  positioningAnchor: chevron,        // Arrow centers on this
  arrowSide: 'top',
  bodyContent: html`
    <ul class="options">
      <li>Option 1</li>
      <li>Option 2</li>
      <li>Option 3</li>
    </ul>
  `,
  onOpen: () => button.classList.add('open'),
  onClose: () => button.classList.remove('open')
})

container.appendChild(button)
container.appendChild(infoBubble.dom)
```

### With Callbacks

```typescript
const boundaryIcon = html`<div class="boundary-icon"></div>`

const infoBubble = createInfoBubble({
  id: 'thread-info',
  anchor: boundaryIcon,
  headerContent: html`<strong>Thread Context</strong>`,
  bodyContent: html`<p>Details here</p>`,
  onOpen: () => {
    console.log('Bubble opened')
    boundaryIcon.classList.add('active')
  },
  onClose: () => {
    console.log('Bubble closed')
    boundaryIcon.classList.remove('active')
  }
})
```

### With Custom Arrow Offset (for larger border-radius)

```typescript
// For bubbles with larger border-radius, move arrow away from corners
const infoBubble = createInfoBubble({
  id: 'large-bubble',
  anchor: triggerButton,
  theme: 'dark',
  arrowSide: 'right',
  bodyContent: largeContent,
  arrowCrossOffset: 20, // Move arrow 20px from edge (default is 8px)
  className: 'custom-large-bubble' // Add custom styling with border-radius: 10px
})
```

```scss
// In your SCSS file
.info-bubble-wrapper.custom-large-bubble {
  .bubble-container {
    border-radius: 10px; // Larger radius requires larger arrow offset
    min-width: 500px;
  }
}
```

### Programmatic Control

```typescript
// You can still control bubble programmatically
infoBubble.open()           // Open manually
infoBubble.close()          // Close manually
infoBubble.toggle()         // Toggle state

if (infoBubble.isOpen()) {
  // Do something when open
}

// Close from within bubble content (e.g., on button click)
const closeButton = html`
  <button onclick=${() => infoBubble.close()}>Close</button>
`
```

## State Management

**Key architectural change**: InfoBubble now owns its state. Consumers don't need to:
- Track open/closed state
- Implement click handlers
- Handle click-outside detection
- Manage mutual exclusion
- Handle repositioning on content changes
- Listen for scroll/resize events

**The bubble does all of this automatically.**

### Communication Pattern

If you need to close the bubble from external code (e.g., when dropdown item selected):

```typescript
const dropdown = createPureDropdown({
  // ... config
  onSelect: (option) => {
    // Update selection
    updateState(option)

    // InfoBubble closes automatically when item is selected
    // No manual close() call needed
  }
})
```

## Advanced Features

### Dynamic Content Updates
When content inside the bubble changes (e.g., filtering a list), the bubble automatically:
1. Detects the change via MutationObserver
2. Recalculates its size
3. Repositions to maintain proper alignment
4. Re-evaluates if arrow flip is needed

No manual `reposition()` call required!

### Custom Offset
Adjust spacing from anchor:

```typescript
createInfoBubble({
  // ...
  arrowSide: 'top',
  offset: { x: 0, y: 30 }  // 30px below anchor instead of default 20px
})
```

For horizontal arrows (`left`/`right`), the `y` value is used as horizontal spacing:

```typescript
createInfoBubble({
  // ...
  arrowSide: 'left',
  offset: { x: 0, y: 25 }  // 25px to the right of anchor
})
```

## Styling

Uses the generic infoBubble SCSS mixins:
- `infoBubblePlacement()` - positioning
- `infoBubbleStructure()` - shape and arrow
- `infoBubbleTheme()` - colors and shadows (M3 level-2 elevation by default)

Arrow positioning is controlled via `data-arrow-side` attribute, not CSS classes.

Dropdown-specific overrides in `infoBubble.scss`:
- `.dropdown-menu-popover` hides the arrow and removes the border (M3 menus are borderless elevated surfaces)


## Notes

- **Anchor element is required** - this is the element that triggers the bubble
- Bubble automatically attaches click handler to anchor
- Bubble automatically handles click-outside-to-close
- Only one bubble can be open at a time (enforced by state manager)
- For dropdowns with selection lists, use the `dropdown` primitive (which uses infoBubble internally)

# Bubble Menu Plugin (ProseMirror Adapter)

ProseMirror-specific adapter over the framework-agnostic [BubbleMenu core]($src/components/bubbleMenu/README.md). This plugin detects text/image selection context from ProseMirror `EditorView` state and shows context-appropriate formatting options.

## Features

- **Context-aware menu**: Shows different items based on selection type (text vs image)
- **Transform-aware positioning**: Delegates to core `BubbleMenu` positioning with ProseMirror-specific coordinate computation
- **Mobile-first design**: Optimized touch targets, platform-aware debouncing (350ms touch / 200ms desktop)
- **Inline link editing**: Link input panel integrated directly in the bubble menu (no modal dialogs)

### Text Selection Items
- **Text formatting marks**: Bold, Italic, Strikethrough, Inline Code, Link
- **Block actions**: Text type dropdown (Paragraph, Headings), Code Block, Blockquote

### Image Selection Items
- **Alignment**: Left, Center, Right
- **Text Wrap**: None, Wrap Left, Wrap Right
- **Actions**: Create Variant, Wrap in Blockquote, Delete

## Usage

```typescript
import { bubbleMenuPlugin } from '$src/components/proseMirror/plugins/bubbleMenuPlugin/index.ts'

// Add to your EditorState plugins
const plugins = [
  // ... other plugins
  bubbleMenuPlugin(),
]
```

Note: Styles are imported via `$src/components/bubbleMenu/bubbleMenu.scss` (the shared core SCSS). The `ProseMirror.scss` file already imports this.

## Architecture

This plugin is a **thin adapter** over the core `BubbleMenu` class from `$src/components/bubbleMenu/`. The adapter handles:

1. **Selection detection** — ProseMirror-specific logic (`getSelectionContext()`, `NodeSelection`, mark checking)
2. **Position computation** — Converts ProseMirror `coordsAtPos()` or image element rects into `BubbleMenuPositionRequest`
3. **Transaction-driven updates** — ProseMirror calls `update()` on every transaction; the adapter decides whether to show/hide/reposition
4. **Link input management** — ProseMirror-specific panel for URL editing
5. **Image wrapper tracking** — Manages `pm-image-menu-active` CSS class for visual feedback

The core `BubbleMenu` handles DOM creation, context switching, transform-aware positioning, and the prevent-hide pattern.

### Files

- `bubbleMenuPlugin.ts` — ProseMirror `Plugin` + `BubbleMenuView` adapter class
- `bubbleMenuItems.ts` — Menu item configuration (declarative `MENU_ITEMS` list), button creators, and ProseMirror commands
- `bubbleMenu.scss` — Forward to `$src/components/bubbleMenu/bubbleMenu.scss`
- `index.ts` — Public exports

### Selection Context

The menu detects selection type using `getSelectionContext()`:

- `'text'` — Text selection (non-empty)
- `'image'` — NodeSelection of an image node (`image` or `aiGeneratedImage`)
- `'none'` — Empty selection or unsupported node type

**IMPORTANT:** When adding new image-like node types, you MUST update:
1. `getSelectionContext()` in `bubbleMenuItems.ts` — to return `'image'` context
2. `getSelectedImageNode()` in `bubbleMenuItems.ts` — to return the node for actions
3. `getImageElement()` and `getImageWrapper()` in `bubbleMenuPlugin.ts` — for positioning
4. The new node spec must include `alignment`, `textWrap`, and `width` attributes

Each menu item has a `context` array specifying which contexts it appears in.

### Key Components

#### BubbleMenuView

The ProseMirror adapter class. On construction it:

1. Builds ProseMirror-specific menu items via `buildBubbleMenuItems()`
2. Creates a core `BubbleMenu` instance, passing items and optional panels
3. Attaches ProseMirror-specific event listeners (editor mousedown/touchstart, image-resize)

On every ProseMirror transaction (`update()`):
1. Computes `getSelectionContext()` and `shouldShow()`
2. Builds a `BubbleMenuPositionRequest` from ProseMirror state
3. Delegates to `bubbleMenu.show()`, `bubbleMenu.hide()`, or `bubbleMenu.updateContext()`

#### Position Computation

For **text** selections: uses `view.coordsAtPos(from/to)` to get a bounding rect, placement `'above'`.

For **image** selections: uses the image element's `getBoundingClientRect()`, placement `'below'`.

Transform-aware coordinate conversion is handled by the core `BubbleMenu`.

### Menu Structure (Declarative)

The bubble menu is defined via a structured list in `bubbleMenuItems.ts`:

**Text context:**
- Dropdown: Text/Heading levels
- Mark buttons: Bold, Italic, Strikethrough, Link, Inline Code
- Block buttons: Code Block, Blockquote

**Image context:**
- Alignment buttons: Left, Center, Right
- Text wrap buttons: None, Wrap Left, Wrap Right
- Action buttons: Create Variant, Blockquote, Delete

Each button is built with `createEl` from `$src/utils/domTemplates.ts`.

### Mobile Considerations

1. **Debouncing**: 350ms on touch devices vs 200ms on desktop to handle selection handle dragging
2. **Touch targets**: Larger buttons on mobile (40px vs 32px)
3. **Virtual keyboard**: Core listens to `visualViewport.resize` for keyboard appearance
4. **preventHide pattern**: Core handles `mousedown` + `preventDefault` to prevent focus loss when clicking menu buttons

## Future Improvements

See `NEXT-STEPS.md` in the project root for planned features:
- Slash command system for block insertion
- Image drag-and-drop with placeholder pattern

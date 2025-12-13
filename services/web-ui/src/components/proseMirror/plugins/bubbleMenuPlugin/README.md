# Bubble Menu Plugin

A universal floating selection-based bubble menu for ProseMirror that shows context-appropriate options based on what is selected.

## Features

- **Context-aware menu**: Shows different items based on selection type (text vs image)
- **Selection-based positioning**: Uses FloatingUI for text, custom positioning for images (centered below)
- **Mobile-first design**: Optimized touch targets, platform-aware debouncing (350ms touch / 200ms desktop)
- **Inline link editing**: Link input panel integrated directly in the bubble menu (no modal dialogs)

### Text Selection Items
- **Text formatting marks**: Bold, Italic, Strikethrough, Inline Code, Link
- **Block actions**: Text type dropdown (Paragraph, Headings), Code Block, Blockquote

### Image Selection Items
- **Alignment**: Left, Center, Right
- **Text Wrap**: None, Wrap Left, Wrap Right
- **Actions**: Wrap in Blockquote, Delete

## Usage

```typescript
import { bubbleMenuPlugin } from './plugins/bubbleMenuPlugin/index.ts'
import './plugins/bubbleMenuPlugin/bubbleMenu.scss'

// Add to your EditorState plugins
const plugins = [
  // ... other plugins
  bubbleMenuPlugin(),
]
```

## Architecture

### Files

- `bubbleMenuPlugin.ts` - Main plugin with `BubbleMenuView` class
- `bubbleMenuItems.ts` - Menu item configuration with context-aware visibility and creation built from a structured list using `domTemplates`
- `bubbleMenu.scss` - Mobile-first styles with CSS custom properties
- `index.ts` - Exports

### Selection Context

The menu detects selection type using `getSelectionContext()`:

- `'text'` - Text selection (non-empty)
- `'image'` - NodeSelection of an image node
- `'none'` - Empty selection or unsupported node type

Each menu item has a `context` array specifying which contexts it appears in.

### Key Components

#### BubbleMenuView

The main view class that manages:

- Menu visibility based on selection state and context
- Context-aware item visibility (show/hide based on selection type)
- FloatingUI positioning for text, custom centered positioning for images
- Debounced updates for performance (especially on mobile during selection handle dragging)
- Link input panel state
- Image resize event handling for real-time position updates

#### Virtual Element (Text Selection)

Uses ProseMirror's `coordsAtPos()` to create a virtual element for FloatingUI:

```typescript
const virtualElement = {
  getBoundingClientRect: () => {
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    return { left, top, right, bottom, width, height }
  },
}
```

#### Image Positioning

For image selections, the menu is positioned centered below the image:

```typescript
const imageCenterX = imageRect.left + imageRect.width / 2
const toolbarLeft = imageCenterX - toolbarRect.width / 2
const toolbarTop = imageRect.bottom + 8
```

### Menu Structure (Declarative)

The bubble menu is defined via a structured list in `bubbleMenuItems.ts`, making it easy to add new contexts:

**Text context:**
- Dropdown: Text/Heading levels
- Mark buttons: Bold, Italic, Strikethrough, Link, Inline Code
- Block buttons: Code Block, Blockquote

**Image context:**
- Alignment buttons: Left, Center, Right
- Text wrap buttons: None, Wrap Left, Wrap Right
- Action buttons: Blockquote, Delete

Each button is built with `createEl` from `components/domTemplates.ts` so markup is centralized and readable.

### Mobile Considerations

1. **Debouncing**: 350ms on touch devices vs 200ms on desktop to handle selection handle dragging
2. **Touch targets**: Larger buttons on mobile (40px vs 32px)
3. **Virtual keyboard**: Listens to `visualViewport.resize` for keyboard appearance
4. **preventHide pattern**: `mousedown` + `preventDefault` to prevent focus loss when clicking menu buttons

## CSS Custom Properties

Customize the appearance using CSS custom properties:

```css
:root {
  --bubble-menu-bg: #1f2937;
  --bubble-menu-border: rgba(255, 255, 255, 0.1);
  --bubble-menu-text: #e5e7eb;
  --bubble-menu-hover-bg: rgba(85, 150, 124, 0.95); /* matches toggleSwitch hover */
  --bubble-menu-active-mark-bg: rgba(85, 150, 124, 1);
  --bubble-menu-active-mark-text: #f5f3f3;
  --bubble-menu-primary: #55967c;
  --bubble-menu-focus: #55967c;
}
```

## Future Improvements

See `NEXT-STEPS.md` in the project root for planned features:
- Slash command system for block insertion
- Image drag-and-drop with placeholder pattern

# Bubble Menu Plugin

A floating selection-based bubble menu for ProseMirror that appears when text is selected, providing quick access to text formatting options.

## Features

- **Selection-based positioning**: Uses FloatingUI to position the menu above or below the selected text
- **Mobile-first design**: Optimized touch targets, platform-aware debouncing (350ms touch / 200ms desktop)
- **Inline link editing**: Link input panel integrated directly in the bubble menu (no modal dialogs)
- **Text formatting marks**: Bold, Italic, Strikethrough, Inline Code, Link
- **Block actions**: Text type dropdown (Paragraph, Headings), Code Block, Blockquote
- **Accessibility**: ARIA attributes, keyboard navigation support

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
- `bubbleMenuItems.ts` - Menu item configuration and creation built from a structured section list using `domTemplates`
- `bubbleMenu.scss` - Mobile-first styles with CSS custom properties
- `index.ts` - Exports

### Key Components

#### BubbleMenuView

The main view class that manages:

- Menu visibility based on selection state
- FloatingUI positioning with `inline()`, `flip()`, `shift()`, `offset()`, `hide()` middleware
- Debounced updates for performance (especially on mobile during selection handle dragging)
- Link input panel state

#### Virtual Element

Uses ProseMirror's `coordsAtPos()` to create a virtual element for FloatingUI:

```typescript
const virtualElement = {
  getBoundingClientRect: () => {
    const start = view.coordsAtPos(from)
    const end = view.coordsAtPos(to)
    return { left, top, right, bottom, width, height }

### Menu Structure (Declarative)

The bubble menu is defined via a structured list of sections in `bubbleMenuItems.ts`, making it easy to reorder or add controls:

- Dropdown: Text/Heading levels
- Separator
- Mark buttons: Bold, Italic, Strikethrough, Inline Code, Link
- Separator
- Block buttons: Code Block, Blockquote

Each button is built with `createEl` from `components/domTemplates.ts` so markup is centralized and readable.
  },
}
```

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

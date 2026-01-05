# Slash Commands Menu Plugin

A floating command palette that appears when typing `/` at the start of a line or after whitespace, providing quick access to block insertion commands.

## Features

- **Trigger detection**: Activates on `/` at line start or after whitespace
- **Keyboard navigation**: Arrow keys to navigate, Enter/Tab to select, Escape to dismiss
- **Query filtering**: Type to filter commands (e.g., `/h1` filters to "Heading 1")
- **Exclusion zones**: Disabled inside code blocks and document title
- **Mobile-friendly**: Larger touch targets on small screens

## Usage

```typescript
import { slashCommandsMenuPlugin } from '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/index.ts'
import '$src/components/proseMirror/plugins/slashCommandsMenuPlugin/slashCommandsMenu.scss'

// Add to your EditorState plugins
const plugins = [
  // ... other plugins
  slashCommandsMenuPlugin(),
]
```

## Architecture

### Files

- `slashCommandsMenuPlugin.ts` - Main plugin with `SlashCommandsMenuView` class and state management
- `commandRegistry.ts` - Command definitions and filtering logic
- `slashCommandsMenu.scss` - Mobile-first styles
- `index.ts` - Public exports

### Plugin State

```typescript
type SlashCommandsPluginState = {
    active: boolean      // Whether menu is open
    query: string        // Text typed after "/"
    triggerPos: number   // Position where "/" was typed
    selectedIndex: number // Currently highlighted command
}
```

### State Transitions

- **Open**: `handleTextInput` detects `/` at valid position → dispatches `{ type: 'open', triggerPos }`
- **Query update**: `apply` extracts text between trigger and cursor on each transaction
- **Selection change**: Arrow keys dispatch `{ type: 'updateSelectedIndex', selectedIndex }`
- **Close**: Enter/Tab executes command and closes; Escape or invalid state closes via `{ type: 'close' }`

### SlashCommandsMenuView

The main view class that manages:

- Menu DOM construction using `createEl` from `$src/utils/domTemplates.ts`
- Transform-aware positioning that handles CSS scaled/translated ancestors
- Command list rendering with selection highlighting
- Keyboard event handling delegation

### Transform-aware Positioning

Uses ProseMirror's `coordsAtPos()` to get screen coordinates at the `/` trigger position, then converts to local coordinates accounting for CSS transforms on ancestor elements.

## Available Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| Code Block | code, code-block, codeblock, pre | Insert a code block |
| Image | image, img, picture | Insert an image |
| Table | table | Insert a table (Phase 2) |
| File | file, attachment | Attach a file (Phase 2) |

## Adding New Commands

Edit `commandRegistry.ts` to add new commands:

```typescript
const SLASH_COMMANDS: SlashCommand[] = [
  // ... existing commands
  {
    name: 'My Command',
    aliases: ['mycommand', 'mc'],
    icon: myIcon,
    description: 'Does something useful',
    execute: (view: EditorView) => {
      // Your command logic
      return true
    },
  },
]
```

## CSS Custom Properties

Customize appearance using the SCSS variables at the top of `slashCommandsMenu.scss`:

```scss
$slashMenuBg: $steelBlue;
$slashMenuFg: $offWhite;
$slashMenuBorder: color.adjust($steelBlue, $lightness: -10%);
$slashMenuHoverBg: $nightBlue;
$slashMenuSelectedBg: rgba(85, 150, 124, 0.3);
```

## Future Improvements

- **Image upload**: Full file upload with placeholder pattern (see `NEXT-STEPS.md`)
- **Fuzzy matching**: Integrate Fuse.js for better filtering
- **Command categories**: Group commands with section headers
- **Recent commands**: Show recently used commands at top

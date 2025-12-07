# Next Steps - ProseMirror Editor Enhancements

This document outlines planned features for future implementation in the ProseMirror editor.

## 1. Slash Command System

A slash command system for inserting blocks and performing actions, similar to Notion and other modern editors.

### Requirements

- Trigger: Type `/` at the start of a line or after whitespace
- Display: Floating command palette below cursor position
- Navigation: Arrow keys + Enter to select, Escape to dismiss
- Filtering: Type to filter commands (e.g., `/head` filters to headings)

### Commands to Implement

| Command | Description |
|---------|-------------|
| `/h1`, `/h2`, `/h3` | Insert heading blocks |
| `/code` | Insert code block |
| `/quote` | Insert blockquote |
| `/list` | Insert bullet list |
| `/numbered` | Insert ordered list |
| `/todo` | Insert task/checkbox item |
| `/image` | Open image upload dialog |
| `/divider` | Insert horizontal rule |
| `/table` | Insert table |

### Implementation Notes

1. Create a ProseMirror input rule or plugin that watches for `/` input
2. Use FloatingUI for command palette positioning (reuse patterns from bubbleMenuPlugin)
3. Store commands in a registry for extensibility
4. Consider fuzzy matching for filter (e.g., Fuse.js)

### Reference Implementation

```typescript
// Conceptual structure
type SlashCommand = {
  name: string
  aliases: string[]
  icon: string
  description: string
  execute: (view: EditorView) => void
}

const commands: SlashCommand[] = [
  {
    name: 'Heading 1',
    aliases: ['h1', 'heading1', 'title'],
    icon: headingIcon,
    description: 'Large section heading',
    execute: (view) => setBlockType(schema.nodes.heading, { level: 1 })(view.state, view.dispatch)
  },
  // ...
]
```

---

## 2. Image Drag-and-Drop with Placeholder Pattern

Support for inserting images via drag-and-drop, paste, and slash commands with a loading placeholder pattern.

### Requirements

- **Drag and drop**: Drop image files onto the editor
- **Paste**: Paste images from clipboard
- **Slash command**: `/image` to open file picker
- **Placeholder**: Show placeholder node during upload
- **Replace**: Replace placeholder with actual image once uploaded

### Placeholder Pattern

The placeholder pattern handles async image uploads:

1. User drops/pastes image
2. Insert placeholder node immediately with unique ID
3. Upload image in background
4. On success: Replace placeholder with image node
5. On failure: Remove placeholder, show error toast

### Implementation Notes

```typescript
// Placeholder node spec
const imagePlaceholderNodeSpec = {
  group: 'block',
  attrs: {
    uploadId: { default: '' },
    fileName: { default: '' },
    progress: { default: 0 }
  },
  toDOM: (node) => ['div', { class: 'image-placeholder', 'data-upload-id': node.attrs.uploadId }],
  parseDOM: [{ tag: 'div.image-placeholder' }]
}

// Upload handler
async function handleImageDrop(view: EditorView, file: File) {
  const uploadId = generateId()

  // Insert placeholder
  const placeholder = schema.nodes.image_placeholder.create({ uploadId, fileName: file.name })
  const tr = view.state.tr.replaceSelectionWith(placeholder)
  view.dispatch(tr)

  try {
    const url = await uploadImage(file, (progress) => {
      updatePlaceholderProgress(view, uploadId, progress)
    })

    replacePlaceholderWithImage(view, uploadId, url)
  } catch (error) {
    removePlaceholder(view, uploadId)
    showError('Image upload failed')
  }
}
```

### Events to Handle

1. **Drop event**: `handleDrop` in plugin
2. **Paste event**: `handlePaste` or `clipboardTextParser`
3. **File input**: For slash command `/image`

### Mobile Considerations

- Support camera capture on mobile (`accept="image/*"` with `capture` attribute)
- Handle orientation from EXIF data
- Compress large images before upload
- Show progress indicator for slow mobile connections

---

## 3. Related Improvements

### 3.1 Keyboard Shortcuts Reference

Add a keyboard shortcuts modal/panel accessible via `?` or menu:
- Formatting shortcuts (Ctrl+B, Ctrl+I, etc.)
- Block shortcuts (Ctrl+Shift+1 for H1, etc.)
- Navigation shortcuts

### 3.2 Undo/Redo in Bubble Menu

Consider adding undo/redo buttons to the bubble menu for mobile users who don't have easy keyboard access.

### 3.3 Selection Toolbar on Mobile

For mobile, consider a bottom-anchored toolbar that appears when the keyboard is hidden but editor is focused, providing quick access to common actions.

---

## Priority Order

1. **Slash Command System** - High value, enables faster content creation
2. **Image Drag-and-Drop** - Essential for content-rich documents
3. **Keyboard Shortcuts Reference** - Nice-to-have for discoverability
4. **Mobile Selection Toolbar** - Consider after testing current bubble menu on real devices

---

## Files to Create

```
services/web-ui/src/components/proseMirror/plugins/
├── slashCommandPlugin/
│   ├── index.ts
│   ├── slashCommandPlugin.ts
│   ├── commandRegistry.ts
│   ├── commandPalette.scss
│   └── README.md
└── imageDragDropPlugin/
    ├── index.ts
    ├── imageDragDropPlugin.ts
    ├── placeholderNode.ts
    ├── imageUploader.ts
    └── README.md
```

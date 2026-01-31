# Image Selection Plugin

This plugin provides rich image editing functionality in the ProseMirror editor for **both `image` and `aiGeneratedImage` node types**, including:

- **Visual Selection** - Images display corner indicators when hovered or selected
- **Resize Handles** - Drag any corner handle to resize images (width only, aspect ratio is always preserved)
- **Percentage Width** - Image widths are stored as percentages for responsive behavior
- **Bubble Menu Integration** - When an image is selected, the bubble menu shows image-specific options

## Supported Node Types

This plugin handles two node types:

1. **`image`** - Regular images inserted via slash command or drag-drop
2. **`aiGeneratedImage`** - AI-generated images from the chat thread plugin

**IMPORTANT:** Both node types MUST have these attributes for the bubble menu to work:
- `width` - Percentage string, e.g., "50%"
- `alignment` - 'left' | 'center' | 'right'
- `textWrap` - 'none' | 'left' | 'right'

The `ImageNodeView` class handles both types using a helper `getImageSrcAttr()` that reads from either `src` (for `image`) or `imageData` (for `aiGeneratedImage`).

## Features

### Image Alignment
- **Left** - Align image to the left (default)
- **Center** - Center the image
- **Right** - Align image to the right

### Text Wrapping
- **None** - No text wrap, image is a standalone block
- **Wrap Left** - Image floats to the left, text wraps on the right
- **Wrap Right** - Image floats to the right, text wraps on the left

Text wrapping uses the modern CSS `shape-outside` property for smooth text flow around images.

### Actions
- **Wrap in Blockquote** - Wraps the image in a blockquote element
- **Delete** - Removes the image from the document

## Files

- `imageNodeView.ts` - Custom ProseMirror NodeView for images with four corner resize handles (handles both `image` and `aiGeneratedImage`)
- `imageSelectionPlugin.ts` - Plugin that registers the custom NodeView for both node types
- `imageSelection.scss` - Styles for image wrapper, resize handles, alignment, and text wrap
- `index.ts` - Module exports

**Adding a new image-like node type:**
1. Add the node type to `imageSelectionPlugin.ts` nodeViews
2. Ensure the node spec has `src` OR `imageData`, plus `width`, `alignment`, `textWrap` attributes
3. Update `bubbleMenuPlugin.ts` and `bubbleMenuItems.ts` as described in the bubbleMenuPlugin README

Note: Image toolbar functionality is integrated into the `bubbleMenuPlugin` which automatically shows context-appropriate items based on selection type (text vs image).

## Schema Requirements

Both `image` and `aiGeneratedImage` nodes must be block level with these attributes:

```typescript
// Regular image node
image: {
  inline: false,
  group: "block",
  attrs: {
    src: {},                          // Image URL or path
    alt: {default: null},
    title: {default: null},
    fileId: {default: null},
    documentId: {default: null},
    width: {default: null},           // Percentage string, e.g., "50%"
    alignment: {default: 'left'},     // 'left' | 'center' | 'right'
    textWrap: {default: 'none'}       // 'none' | 'left' | 'right'
  }
}

// AI-generated image node (in aiChatThreadPlugin)
aiGeneratedImage: {
  inline: false,
  group: "block",
  attrs: {
    imageData: {},                    // Image URL or base64 data
    fileId: {default: null},
    revisedPrompt: {default: null},
    responseId: {default: null},
    aiModel: {default: null},
    isPartial: {default: true},
    width: {default: null},           // Percentage string
    alignment: {default: 'left'},     // 'left' | 'center' | 'right'
    textWrap: {default: 'none'}       // 'none' | 'left' | 'right'
  }
}
```

## Usage

The plugin is automatically registered in the editor. To use:

1. Insert an image using the slash command `/image`
2. Click on the image to select it
3. Use the bubble menu to adjust alignment, text wrap, or delete
4. Drag any corner handle to resize the image

## CSS Classes

- `.pm-image-wrapper` - Figure element wrapping the image
- `.pm-image-align-{left|center|right}` - Alignment modifier classes
- `.pm-image-wrap-{none|left|right}` - Text wrap modifier classes
- `.pm-image-resize-handle` - Base class for resize handle elements
- `.pm-image-resize-{top-left|top-right|bottom-left|bottom-right}` - Corner-specific handle classes

# Dropdown Primitive

Dropdown menus for ProseMirror NodeViews. Lives outside the document schema – never part of saved content.

## What it is

A factory function that creates dropdown UI controls. Used by AI Chat Thread for model/context selection. **Built on top of the InfoBubble primitive** - dropdown provides the button and options, infoBubble handles all state management, positioning, and auto-flip logic.

**Key features:**
- Not a document node (no NodeSpec)
- Appended directly to your controls container
- Uses InfoBubble for state management and positioning
- **Auto-repositioning** when content changes (e.g., filtering)
- **Smart positioning** with automatic arrow flip
- **Precise alignment** with arrow pointing to chevron icon
- Tag-based filtering support
- Returns `{dom, update, destroy}`

## Architecture

Dropdown uses `infoBubble` primitive, which handles:
- Open/closed state
- Click handling on button
- Click-outside-to-close
- Mutual exclusion (only one dropdown open at a time)
- **Auto-repositioning on content changes**
- **Smart arrow flipping** when space is limited
- Scroll and resize tracking

**Dropdown's only responsibility**: Provide button (anchor) and content (options list).

## Why not document nodes?

Previously, dropdowns were ProseMirror document nodes. Problems:
- Rendered in `contentDOM` first, required relocation via `requestAnimationFrame`
- Complex state management via decorations
- Became part of document content (gets serialized)
- NodeView recreated when dropdown opened/closed

Now: direct DOM append to controls container. Renders instantly where you put it.

## API

### `createPureDropdown(config)`

```typescript
createPureDropdown({
  id: 'unique-id',
  selectedValue: { title: 'Option 1', icon: svgString, color: '#color' },
  options: [
    { title: 'Option 1', icon: svgString, color: '#color' },
    { title: 'Option 2', icon: svgString, color: '#color' }
  ],
  onSelect: (option) => { /* dispatch transaction to update node attrs */ },
  theme?: 'dark' | 'light',
  renderPosition?: 'top' | 'bottom',
  buttonIcon?: svgString,
  ignoreColorValuesForOptions?: boolean,
  ignoreColorValuesForSelectedValue?: boolean,
  renderIconForSelectedValue?: boolean,
  renderIconForOptions?: boolean,
  renderTitleForSelectedValue?: boolean,
  enableTagFilter?: boolean,
  availableTags?: ['tag1', 'tag2']
})
// Returns: { dom: HTMLElement, update: (option) => void, destroy: () => void }
```

### Configuration

- `id`: Unique identifier
- `selectedValue`: Currently selected option object
- `options`: Array of option objects
- `onSelect`: Callback when option selected (receives selected option)
- `theme`: 'dark' or 'light' (default: 'dark')
- `buttonIcon`: SVG icon for dropdown button (default: chevron)
- `enableTagFilter`: Show tag filter in dropdown header (default: false)
- `availableTags`: Tags for filtering options
- Various rendering flags for icons, colors, titles

**Note**: `renderPosition` is deprecated and removed. The dropdown now uses InfoBubble's smart auto-flip logic instead.

### Return Value

- `dom`: HTMLElement to append to your container
- `update(option)`: Update selected value display
- `destroy()`: Clean up (automatically handled by infoBubble)

## Usage Pattern

```typescript
class MyNodeView implements NodeView {
  dropdown = createPureDropdown({
    id: 'my-dropdown',
    selectedValue: node.attrs.selectedOption,
    options: [
      { title: 'Option 1', icon: icon1, color: '#ff0000' },
      { title: 'Option 2', icon: icon2, color: '#00ff00' }
    ],
    onSelect: (option) => {
      // Update node attribute via transaction
      view.dispatch(
        view.state.tr.setNodeMarkup(
          getPos(),
          null,
          { ...node.attrs, selectedOption: option }
        )
      )
    }
  })

  constructor() {
    controlsContainer.appendChild(this.dropdown.dom)
  }

  update(node) {
    this.dropdown.update(node.attrs.selectedOption)
    return true
  }

  destroy() {
    this.dropdown.destroy()
  }

  ignoreMutation(mutation) {
    // CRITICAL: Prevents NodeView recreation when dropdown opens/closes
    return controlsContainer.contains(mutation.target)
  }
}
```

See `aiChatThreadNode.ts` for real example.

## State Management

**Dropdown does NOT manage state.** InfoBubble handles everything:
- Button click → InfoBubble toggles open/close
- Click outside → InfoBubble closes
- Mutual exclusion → InfoBubble state manager ensures only one dropdown open
- **Content changes → InfoBubble auto-repositions**
- **Insufficient space → InfoBubble auto-flips arrow**

**When option selected:**
```typescript
onSelect: (option) => {
  updateState(option)       // Update your state
  infoBubble.close()        // Manually close the bubble
}
```

**No need to:**
- Track open/closed state
- Implement window click handler
- Subscribe to state changes
- **Manually reposition when filtering options**
- **Check for space before rendering**

**InfoBubble does all of this automatically.**

## Positioning Behavior

### Smart Auto-Positioning
The dropdown uses InfoBubble's positioning system:
- **Arrow points to chevron**: The `positioningAnchor` is set to the chevron icon, so the arrow always points to it
- **Auto-flip**: If there's not enough space below, the dropdown automatically flips above
- **Auto-reposition**: When filtering reduces/expands the options list, the dropdown repositions automatically
- **Scroll tracking**: Follows the anchor element when the page scrolls

### Tag Filtering Example
When you enable tag filtering and toggle filters:
1. Options list shrinks/grows
2. InfoBubble's MutationObserver detects the change
3. Bubble recalculates size and repositions
4. Arrow flip is re-evaluated if needed

**All automatic - no manual code required!**

## Common Issues

**Dropdown closes immediately after opening**
- Forgot `ignoreMutation()` in NodeView. PM sees DOM changes and recreates your NodeView.
- Solution: `ignoreMutation(m) { return controlsContainer.contains(m.target) }`

**Dropdown appears in contentDOM**
- Appending to wrong container.
- Solution: Append to your controls container, not `this.contentDOM`

**State not updating**
- Forgot to call `dropdown.update()` in NodeView's `update()` method.

**Multiple dropdowns open at once**
- This should not happen - infoBubble state manager enforces mutual exclusion
- If it does, check that each dropdown has a unique `id`

**Dropdown doesn't reposition when filtering**
- This should happen automatically via InfoBubble's MutationObserver
- If it doesn't, check browser console for errors
- Verify the options list is inside the bubble's body content

**Dropdown appears in wrong position**
- InfoBubble positions the arrow to point at the chevron icon (`.state-indicator`)
- If positioning seems off, verify the chevron element exists and has proper dimensions

**Dropdown doesn't flip when near viewport edge**
- Auto-flip only occurs when the opposite side has sufficient space
- If neither side has space, the original `arrowSide` is used
- Check `offset` configuration - larger offsets require more space

## Architecture Diagram

```
Dropdown Primitive
  ├─ Button (anchor)
  │   └─ [InfoBubble attaches click handler]
  │
  └─ InfoBubble Primitive
      ├─ State Management
      │   ├─ Open/Close state
      │   ├─ Click outside detection
      │   └─ Mutual exclusion
      │
      └─ Content
          ├─ Header (optional tag filter)
          └─ Body (options list)
```

## Notes

- Dropdown is a specialized use case of InfoBubble
- For simple info panels without selection, use InfoBubble directly
- InfoBubble handles ALL interaction logic
- Dropdown only provides specialized content (button + options list)

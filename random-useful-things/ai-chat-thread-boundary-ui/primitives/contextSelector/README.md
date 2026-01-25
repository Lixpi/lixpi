# ContextSelector Primitive

Generic toggle button group for selecting one option from multiple choices. Lives outside the document schema – never part of saved content.

## What it is

A factory function that creates a button group with radio-button-like behavior where only one option can be selected at a time. **Manages its own state** including selection state and change events.

**Key features:**
- Not a document node (no NodeSpec)
- Completely generic - works with any set of options
- **Owns its selection state**
- Toggle buttons with visual feedback
- Single selection (radio button behavior)
- Optional icons for each option
- Callback on selection change
- Returns `{dom, getValue, setValue, update, destroy}`

## Architecture

The contextSelector is a **stateful interactive component**:
- **Container** (`.context-selector`): Main wrapper with role="radiogroup"
- **Options** (`.context-options`): Flex container for buttons
- **Buttons** (`.context-option-button`): Individual toggle buttons with selected state
- **State**: Internally tracks currently selected value
- **Events**: Handles clicks and dispatches onChange callback

## Why not document nodes?

UI controls like this should live outside the document schema:
- Not semantic content that needs to be saved
- Pure presentational control
- Simple state management
- Never part of document serialization

## API

### `createContextSelector(config)`

```typescript
createContextSelector({
  id: 'unique-id',
  options: [
    { label: 'Option 1', value: 'opt1', icon?: '<svg>...</svg>' },
    { label: 'Option 2', value: 'opt2' },
    // ... more options
  ],
  selectedValue?: 'opt1',          // Initial selection (defaults to first option)
  threadCount?: 3,                 // Total number of threads in document (for visualization)
  currentThreadIndex?: 1,          // This thread's 0-based position (for visualization)
  threadSelections?: [             // Workspace selection state for each thread
    { threadId: 'thread-1', selected: false },
    { threadId: 'thread-2', selected: true }
  ],
  onChange?: (value: string) => void,
  onThreadSelectionChange?: (threadId: string, selected: boolean) => void  // Workspace checkbox handler
})
// Returns: {
//   dom: HTMLElement,
//   getValue: () => string,          // Get currently selected value
//   setValue: (value: string) => void, // Programmatically set selection
//   update: (config: Partial<Config>) => void, // Update configuration
//   destroy: () => void
// }
```

### Configuration

- `id`: Unique identifier for this selector
- `options`: Array of options with label, value, and optional icon
- `selectedValue`: Initial selected value (default: first option)
- `threadCount`: Total number of threads in document (default: 3) - used for dynamic visualization
- `currentThreadIndex`: This thread's 0-based position (default: 1) - used to highlight current thread
- `currentThreadId`: The threadId of the current thread - used to disable toggle in Workspace mode (current thread is always included)
- `threadSelections`: Array of workspace selection states for each thread - only used in Workspace mode
- `onChange`: Callback executed when selection changes
- `onThreadSelectionChange`: Callback executed when a checkbox is toggled in Workspace mode

### Return Value

- `dom`: HTMLElement to append to your container
- `getValue()`: Returns currently selected value
- `setValue(value)`: Programmatically change selection
- `update(config)`: Update configuration (e.g., change selected value)
- `destroy()`: Clean up event listeners

## Usage Example

```typescript
import { createContextSelector } from '$src/components/proseMirror/plugins/primitives/contextSelector/index.ts'

const selector = createContextSelector({
  id: 'thread-context-selector',
  options: [
    { label: 'Thread', value: 'Thread' },
    { label: 'Document', value: 'Document' },
    { label: 'Workspace', value: 'Workspace' }
  ],
  selectedValue: 'Thread',
  onChange: (value) => {
    console.log('Selected:', value)
    // Update your application state
  }
})

// Append to container
container.appendChild(selector.dom)

// Get current value
const current = selector.getValue() // 'Thread'

// Programmatically change selection
selector.setValue('Document')

// Clean up when done
selector.destroy()
```

## Dynamic Thread Visualization

The context selector now supports **dynamic thread visualization** that reflects the actual document state:

### Thread-Aware Visualization

Each selector instance knows:
- **Total thread count** in the document (`threadCount`)
- **Its own position** among threads (`currentThreadIndex`)

This enables thread-specific visualizations:

**Thread Mode:**
- Renders N document icons (one per thread in the document)
- Highlights only THIS thread's document block
- Arrow from highlighted document block → AI
- Other threads fade back but remain visible

**Document Mode:**
- Renders N document icons (all threads active)
- Arrows from ALL document blocks → AI
- Shows all threads contribute to the shared context

**Workspace Mode:**
- Mirrors Document mode (workspace scope) with a slightly wider arc
- Shows checkboxes (toggle switches) to the left of each document shape
- Checkboxes allow selective inclusion of threads in the AI context
- **Current thread's toggle is always checked and disabled (grayed out)** - the thread where you're submitting from is always included
- Selection state is preserved even when switching to other modes
- Only threads with checked boxes show active connections to AI

### Integration Example

```typescript
import { getThreadPositionInfo } from '$src/components/proseMirror/plugins/aiChatThreadPlugin.ts'

// In NodeView creation
const threadPosInfo = getThreadPositionInfo(view, threadId)

const selector = createContextSelector({
  id: `context-${threadId}`,
  options: [...],
  threadCount: threadPosInfo.totalCount,      // Dynamic thread count
  currentThreadIndex: threadPosInfo.index,    // This thread's position
  onChange: (value) => { /* update context */ }
})

// Update on document changes
const update = (updatedNode) => {
  const newPosInfo = getThreadPositionInfo(view, threadId)
  selector.update({
    threadCount: newPosInfo.totalCount,
    currentThreadIndex: newPosInfo.index
  })
}
```

The visualization automatically updates when threads are added, removed, or reordered.

## Architecture

The contextSelector uses a **layered abstraction** for rendering visualizations:

1. **Shape Factories** (`primitives/infographics/shapes/`): Encapsulate visual styling and structure
  - `createDocumentBlockShape()` - Wraps the animated document visualization (from `documentShape`) for stackable blocks
  - `createIconShape()` - SVG icons in containers
  - Returns `NodeConfig` objects with ALL styling/structure knowledge

2. **Connector System** (`primitives/infographics/connectors/`): Renders nodes and edges
   - Manages SVG rendering and layout
   - Computes anchor points for edge connections
   - Handles edge path computation using XYFlow utilities

3. **ContextSelector** (this component): Orchestration and business logic only
   - Knows WHAT shapes to use (threads, labels, icons)
   - Knows WHERE to place them (layout coordinates)
   - Knows WHEN to show edges (based on context mode)
   - Does NOT know HOW to style or render shapes

This separation means:
- ✅ Shape styling is centralized and reusable
- ✅ contextSelector is purely logic/layout
- ✅ Adding new visualizations is trivial
- ✅ Shape styles can change without touching contextSelector

## Styling

The component combines Tailwind utilities with purpose-built SCSS:
- `.context-selector`: Main container where we expose CSS custom properties for theming.
- `.context-options`: Flex wrapper for the toggle buttons.
- `.context-option-button`: Individual buttons with hover/selected affordances; receives `.selected` for the active state.
- `.context-visualization`: Dark canvas that hosts the SVG rendered by the connector system.

**Semantic shape styling:**
The contextSelector applies semantic CSS classes (`.ctx-document`, `.ctx-llm`) that style the underlying shape primitives:

```scss
.shape-node.document-block-shape.ctx-document-active {
  transform: translateX(4px) scale(1.04);
}

.shape-node.document-block-shape.ctx-document-muted {
  opacity: 0.48;
}

.icon-shape.ctx-llm .icon-content {
  svg { fill: rgba(167, 139, 250, 0.92); }
}
```

This keeps visual styling in contextSelector.scss while structural/rendering concerns live in the shape system.

**Visualization architecture:**
This component uses the **shapes and connector systems** (see `primitives/infographics/shapes/README.md` and `primitives/infographics/connectors/README.md`) which provide:
- Reusable node and edge abstractions powered by XYFlow and D3
- Declarative API for defining connections between visual elements
- Automatic marker (arrowhead) management with unique instance IDs
- Support for multiple path types (bezier, horizontal-bezier, straight, smoothstep)

Key visualization details:
- Open arrowheads (`polyline`) and curved edges reuse the same stroke widths as XYFlow defaults.
- Edges originate directly from each node boundary using computed anchor points.
- Node centers are spaced evenly across the baseline to create clean, aligned diagrams.
- The connector system handles all SVG creation, path computation, and marker definitions.

You can override the exposed CSS variables inside `.context-selector` to tweak colors or thickness without touching the TypeScript. See `contextSelector.scss` for the complete list of variables and defaults.

## Integration with ProseMirror

This primitive is designed to be used in NodeViews or plugin UI controls:

```typescript
function createMyNodeView(node, view, getPos) {
  const selector = createContextSelector({
    id: `selector-${node.attrs.id}`,
    options: [...],
    selectedValue: node.attrs.context,
    onChange: (value) => {
      // Update node attributes via transaction
      const pos = getPos()
      if (pos !== undefined) {
        const tr = view.state.tr.setNodeMarkup(
          pos,
          undefined,
          { ...node.attrs, context: value }
        )
        view.dispatch(tr)
      }
    }
  })

  controlsContainer.appendChild(selector.dom)

  return {
    dom,
    contentDOM,
    update: (newNode) => {
      selector.update({ selectedValue: newNode.attrs.context })
      return true
    },
    destroy: () => {
      selector.destroy()
    }
  }
}
```

## Accessibility

The component includes proper ARIA attributes:
- `role="radiogroup"` on container
- `role="radio"` on buttons
- `aria-checked` and `aria-pressed` on buttons
- `aria-label` on container

This ensures screen readers can properly announce the selection state and allow keyboard navigation.

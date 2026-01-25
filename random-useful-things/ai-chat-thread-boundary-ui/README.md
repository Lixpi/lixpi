# AI Chat Thread Boundary UI (Archived)

This folder contains archived code for the AI chat thread boundary indicator system. This UI was removed because AI chat threads are now standalone canvas nodes rather than embedded in documents, making the boundary visualization and context selection features obsolete.

## Why This Was Removed

Previously, AI chat threads were part of documents - multiple threads could exist within a single document. The boundary indicator helped users:
- Visualize which content belonged to which thread
- Select context scope (Thread/Document/Workspace) for AI submissions
- Collapse/expand individual threads

Now that each AI chat thread is an independent canvas node, these features no longer make sense:
- There's no need to show boundaries between threads in a document (threads are separate nodes)
- Context selection across multiple threads in a "document" is irrelevant
- Collapsing is handled differently at the canvas level

## What's In This Archive

### Core Components

#### `primitives/contextSelector/`
A reusable toggle button group primitive for selecting one option from multiple choices. Features:
- Factory pattern: `createContextSelector(config)` returns `{dom, getValue, setValue, update, destroy}`
- Radio-button-like behavior with visual feedback
- Dynamic visualization showing document icons connected to an AI icon
- Sliding background animation between options
- Toggle switches for Workspace mode

**Key Pattern:** UI controls outside the document schema - not ProseMirror nodes, just DOM elements.

#### `boundaryIndicator.ts`
Functions for creating the thread boundary UI:
- `createThreadBoundaryIndicator()` - Creates the boundary line and icons
- `createThreadInfoBubble()` - Creates the info bubble containing the context selector

#### `threadPositionUtils.ts`
Utility to find a thread's position among all threads in the document. Used for the dynamic visualization showing N document icons.

#### `boundary-styles.scss`
SCSS styles for:
- `.ai-thread-boundary-indicator` - The icon container
- `.ai-thread-boundary-indicator-line` - The vertical line
- `.ai-thread-collapse-toggle` - The collapse toggle with iOS-style animations
- `.collapsed` state with fade-out gradient

## Folder Structure

```
ai-chat-thread-boundary-ui/
├── README.md                    # This file
├── boundaryIndicator.ts         # Boundary UI creation functions
├── boundary-styles.scss         # SCSS styles for boundary components
├── threadPositionUtils.ts       # Thread position utilities
└── primitives/
    └── contextSelector/         # Original contextSelector primitive (moved from active codebase)
        ├── contextSelector.ts   # Main implementation
        ├── contextSelector.scss # Styles
        ├── index.ts             # Exports
        └── README.md            # Original documentation
```

## Key Patterns Worth Reusing

### 1. Factory Pattern for UI Primitives

```typescript
const selector = createContextSelector({
    id: 'my-selector',
    options: [
        { label: 'Option 1', value: 'opt1', icon: '<svg>...' },
        { label: 'Option 2', value: 'opt2' }
    ],
    onChange: (value) => console.log('Selected:', value)
})

container.appendChild(selector.dom)

// Later...
selector.update({ selectedValue: 'opt2' })
selector.destroy()
```

### 2. Transaction Meta Pattern

State changes flow through ProseMirror transactions via metadata:

```typescript
// Dispatching a state change
view.dispatch(view.state.tr.setMeta('toggleCollapse', { threadId, nodePos }))

// Handling in appendTransaction
const collapseTransaction = transactions.find(tr => tr.getMeta('toggleCollapse'))
if (collapseTransaction) {
    const { nodePos } = collapseTransaction.getMeta('toggleCollapse')
    // Update node attributes...
}
```

### 3. Decoration-Driven Visual State

Visual states are applied via decorations, not direct DOM manipulation:

```typescript
// In plugin's decorations function
state.doc.descendants((node, pos) => {
    if (node.type.name === 'aiChatThread' && node.attrs.isCollapsed) {
        decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
                class: 'collapsed'
            })
        )
    }
})
```

CSS then handles the visual change:
```scss
.ai-chat-thread-wrapper.collapsed {
    .ai-chat-thread-content {
        max-height: 60px;
        overflow: hidden;
    }
}
```

### 4. iOS-Style Click Feedback Animation

```scss
@include clickToggleFeedbackAnimation((
    startColor: lighten($nightBlue, 30%),
    flashColor: lighten($nightBlue, 15%),
    endColor: $nightBlue
));
```

### 5. Dynamic Visualization with D3 and Connector System

The context selector used the infographics system to render a visualization:
- Document shapes representing threads
- Arrows connecting active threads to an AI icon
- Toggle switches for workspace mode

```typescript
connector = createConnectorRenderer({
    container: visualizationContainer,
    width: VIEWBOX_WIDTH,
    height: VIEWBOX_HEIGHT,
    instanceId
})

connector.addNode(createIconShape({ id: 'doc-1', ... }))
connector.addEdge({ source: 'doc-1', target: 'llm', ... })
connector.render()
```

## Integration Points (How It Was Used)

In `aiChatThreadNode.ts` NodeView:

```typescript
// Constructor
const { boundaryIndicator, collapseToggleIcon, infoBubble, contextSelector } =
    createThreadBoundaryIndicator(dom, view, threadId, getPos, node.attrs.isCollapsed)

dom.appendChild(threadBoundaryIndicator)
document.body.appendChild(infoBubble.dom)

// Update
contextSelector?.update({
    selectedValue: updatedNode.attrs.threadContext,
    threadCount: threadPosInfo.totalCount,
    currentThreadIndex: threadPosInfo.index
})

// Destroy
infoBubble?.destroy()
contextSelector?.destroy()
```

In `aiChatThreadPlugin.ts`:

```typescript
// State handling
const hoverThreadMeta = tr.getMeta('hoverThread')
if (hoverThreadMeta !== undefined) {
    return { ...prev, hoveredThreadId: hoverThreadMeta }
}

// Decorations
const boundaryDecorations = this.createThreadBoundaryDecorations(state, pluginState)
const collapsedDecorations = this.createCollapsedStateDecorations(state)
```

## Dependencies

This code relied on:
- `$src/utils/domTemplates.ts` - `html` template helper
- `$src/infographics/connectors/` - SVG connector rendering
- `$src/infographics/shapes/` - Shape primitives (iconShape, documentShape)
- `$src/components/proseMirror/plugins/primitives/infoBubble/` - Floating bubble container
- Various SVG icons from `$src/svgIcons/`

## Node Attributes (Removed)

These attributes were on the `aiChatThread` node:
- `threadContext: 'Thread' | 'Document' | 'Workspace'` - Context scope
- `isCollapsed: boolean` - Whether thread content is collapsed
- `workspaceSelected: boolean` - Whether thread is selected in Workspace mode

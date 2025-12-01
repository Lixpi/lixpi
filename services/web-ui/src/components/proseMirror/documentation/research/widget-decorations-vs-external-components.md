# Building Complex UI in ProseMirror: What I Learned

I had to figure out the best way to build complex interactive components in ProseMirror. The main question was whether to keep using decorations and the transaction system for everything, or switch to external components like regular menus.

After digging deep into both approaches, here's what I discovered.

## The Two Approaches I Studied

### What ProseMirror Actually Does

ProseMirror works with immutable documents. Everything is a tree of nodes, and changes happen through transactions. The key insight is that decorations let you add UI elements that become part of this system.

Widget decorations are the main way to embed custom DOM at specific positions:
- `Decoration.widget()` puts a DOM element at a position
- The decoration moves with the document as people edit
- Your UI participates in undo/redo automatically

The alternative is external components - regular DOM elements outside the document that you manually sync with the editor state.

### Example Implementations Analysis

#### Widget Decorations (Upload, Tooltip, Lint Examples)
**Upload Example**: Shows asynchronous operations with placeholder decorations
```javascript
let widget = document.createElement("placeholder")
let deco = Decoration.widget(action.add.pos, widget, {id: action.add.id})
```

**Tooltip Example**: Demonstrates external positioning using `coordsAtPos()`
```javascript
let start = view.coordsAtPos(from), end = view.coordsAtPos(to)
this.tooltip.style.left = (left - box.left) + "px"
```

**Lint Example**: Interactive decorations with event handling
```javascript
decos.push(Decoration.inline(prob.from, prob.to, {class: "problem"}),
           Decoration.widget(prob.from, lintIcon(prob), {key: prob.msg}))
```

#### Node Views (CodeMirror, Footnote Examples)
**CodeMirror Example**: Fully embedded sub-editor with bidirectional state sync
- Handles cursor movement between inner/outer editors
- Forwards updates via transaction mapping
- Complex keyboard navigation logic

**Footnote Example**: Modal editing pattern with sub-ProseMirror instance
- Nested editor appears only on selection
- Sophisticated transaction forwarding with offset mapping
- Handles external updates via diff detection

#### Menu System (External Component Pattern)
**Menu Example**: External UI component approach
```javascript
class MenuView {
  constructor(items, editorView) {
    this.items = items
    this.editorView = editorView
    this.dom = document.createElement("div")
    // External DOM management
  }
  update() {
    // Query commands for enabled state
    this.items.forEach(({command, dom}) => {
      let active = command(this.editorView.state, null, this.editorView)
      dom.style.display = active ? "" : "none"
    })
  }
}
```

## What I Found in Real Code

### The Decoration Approach (My Current aiChatThreadPlugin)

I looked at my own chat plugin that uses decorations. Here's how it works:

The plugin creates UI components that live inside the document. When someone types, the decorations automatically move to stay in the right place. The UI state flows through ProseMirror's transaction system - every change gets recorded and can be undone.

What I noticed:
- 751 lines of pretty complex code managing state coordination
- Everything has to go through transactions, even simple UI updates
- But collaboration "just works" - multiple users see the same thing automatically
- Position tracking is handled by ProseMirror, so concurrent edits don't break the UI

### The External Component Approach (ProseMirror's Menu)

Then I studied how ProseMirror's own menu system works. Totally different strategy:

The menu creates a wrapper div around the entire editor. It manually listens for editor changes and updates itself. The menu DOM is completely separate from the document.

What I found:
- Much simpler conceptually - just regular DOM manipulation
- 631 lines across two files with cleaner separation
- Updates happen immediately without going through transactions
- But you have to manually coordinate everything with the editor state

## How They Actually Perform

### When Decorations Win
Decorations are great for simple UI that's part of the document. They use ProseMirror's efficient diffing, and everything stays in sync automatically. For things like comments or inline widgets, this approach is solid.

### When External Components Win
Heavy interactive stuff like charts or complex forms perform much better as external components. They can update instantly without waiting for the transaction system. If you're building something like a data visualization that updates frequently, external is the way to go.

## The Big Tradeoffs

### Collaboration Changes Everything

This was the biggest revelation. With decorations, collaboration just works. When multiple people edit the same document, their UI elements stay synchronized automatically. ProseMirror handles all the position mapping and conflict resolution.

With external components, you're on your own. If two people are editing and you have an external dropdown open, you need custom logic to keep it positioned correctly and in sync between clients.

### Development Complexity is Real

Decorations have a steep learning curve. You need to really understand ProseMirror's internals - transactions, plugin state, position mapping. It's not beginner-friendly.

External components use familiar patterns. Most developers can build a dropdown or form component without learning ProseMirror's quirks. But then you spend time on state synchronization boilerplate.

### Performance Depends on the Component

For simple UI like tooltips or inline buttons, decorations perform fine. The transaction system isn't a bottleneck.

For heavy interactive stuff - think a chart that redraws 60fps or a complex multi-step form - external components perform much better. You're not bottlenecked by ProseMirror's update cycle.

## What Works for Different Use Cases

### Complex Forms and Inputs
Use external components for the heavy lifting. A complex multi-step form with validation, date pickers, and file uploads performs much better outside the transaction system. But sync the final form state back to the document through plugin state so it works in collaborative scenarios.

### Interactive Charts and Visualizations
Definitely go external. Charts need Canvas or SVG rendering, and they update frequently. The transaction system would be a bottleneck. Position the chart with a decoration, but render it externally.

### Document Comments and Annotations
Stick with decorations. Comments are part of the document content, and collaboration is critical. Users need to see identical annotations, and position mapping is essential when multiple people edit.

### Toolbars and Menus
External components make sense. Toolbars don't need collaboration or position mapping. You can use existing UI libraries and familiar patterns.

### Real-time Collaboration Features
Use decorations for things like user cursors and presence indicators. These need to participate in the operational transformation system to stay consistent across clients.

## My Recommended Hybrid Approach

After studying both patterns, I realized they're not competing - they're complementary. Here's what I'd build:

### The State Bridge Pattern
```
External Component ←→ Plugin State ←→ Decorations ←→ Document
```

- External components handle heavy interactions and rendering
- Plugin state acts as the single source of truth
- Decorations handle positioning and lightweight UI
- All changes flow through transactions to maintain consistency

This gives you:
- Fast performance for complex UI
- Collaboration support through plugin state
- Familiar development patterns
- Full ProseMirror integration

## Practical Implementation

### Start with Plugin State Management
Build a central plugin that manages all UI state. Define clear schemas for how UI updates flow through transactions. This becomes your coordination layer.

### External Components First
Implement your heavy interactive elements (charts, forms) as external components. Get the performance and developer experience benefits. Sync their state through the plugin when needed.

### Add Decorations for Positioning
Use decorations to position external components and handle lightweight UI that's truly part of the document. This keeps the collaborative benefits where they matter.

## What This Means for Your Current Code

Your `aiChatThreadPlugin` is actually pretty solid as a foundation. You've got 751 lines of decoration-driven code that handles collaboration correctly. That's not wasted work.

Here's what I'd do next:

### Profile Your Current Performance
See which parts of your UI cause slowdowns. Is it the chat interface updates? The streaming content insertion? The complex forms you mentioned wanting to build?

### Selective Migration Strategy
Don't rewrite everything. Keep the collaborative parts as decorations, but move heavy interactive components external. You can do this incrementally.

For example:
- Keep chat messages as decorations (collaboration is key)
- Move complex form inputs external (performance matters)
- Use plugin state to coordinate between both

### Testing the Boundaries
The tricky part is where the two patterns meet. Test these interaction points carefully - that's where edge cases hide.

## Bottom Line

You don't have to choose one approach. The best ProseMirror UIs use both patterns strategically:

- Decorations for collaborative, document-integrated UI
- External components for heavy interactive elements
- Plugin state to bridge between them
- Transactions as the universal interface for changes

The question isn't "which is better?" - it's "which pattern fits this specific component?" Build a hybrid architecture that uses each approach where it excels.

6. **Extensibility**
   - Customization options
   - Third-party integration
   - Plugin ecosystem fit

7. **Testing & QA**
   - Unit test complexity
   - Integration testing
   - Cross-browser compatibility

8. **Theming & Styling**
   - CSS customization
   - Dynamic styling
   - Brand consistency

## Preliminary Findings

Based on documentation analysis, key trade-offs emerge:

### Decoration-Driven Approach Advantages
- **Tight Integration**: Components exist within document flow, automatically handle position mapping
- **Collaborative-Ready**: Decorations naturally participate in transformation system
- **Performance**: Can leverage ProseMirror's efficient DOM diffing
- **Semantic Coherence**: UI elements are positioned relative to document content

### External Component Approach Advantages
- **Flexibility**: Complete control over DOM structure and positioning
- **Simplicity**: Easier to reason about, standard web component patterns
- **Independence**: Can use external libraries without integration complexity
- **Testing**: Standard DOM testing approaches apply

### Critical Questions to Resolve
1. How does each approach handle rapid document changes during typing?
2. What are the implications for accessibility and screen readers?
3. How do complex nested interactions (dropdowns, modals) work in each pattern?
4. What are the performance characteristics under heavy collaborative editing?

## Next Steps

1. Deep dive into aiChatThreadPlugin implementation
2. Analyze prosemirror-menu architecture
3. Create detailed comparison matrix
4. Develop hybrid approach recommendations
5. Identify optimal use cases for each pattern

---
*Research in progress - Last updated: Sep 25 2025*

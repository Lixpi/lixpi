# ProseMirror plugins – how we build them

This is the shared guide for plugins in our ProseMirror app. Keep generic stuff here. Plugin-specific details (like streaming logic for AI chat) stay in that plugin's own README.

If you want a concrete example, check `aiChatThreadPlugin/README.md`.

Direct link: `./aiChatThreadPlugin/README.md`.

## Folder layout (typical)

```
plugins/
	somePlugin/
		README.md                 # plugin-specific notes
		index.ts                  # exports
		somePlugin.ts             # plugin class / orchestration
		someNode.ts               # Node spec + NodeView (self-contained)
		anotherNode.ts            # …more nodes if needed
		some-plugin.scss          # styles for that plugin

	primitives/                   # reusable UI primitives
		dropdown/                 # dropdown component (outside doc schema)
			README.md             # comprehensive dropdown docs
			pureDropdown.ts          # factory function (creates dropdown DOM + binds to infoBubble)
			index.ts                 # public API

	README.md                   # this file (shared patterns)
```

**Shared utilities:** `$src/utils/domTemplates.ts` provides the `html` templating helper (htm).

## Core patterns we follow

- Node spec + NodeView live together. Each NodeView builds its DOM with templates and owns its events. No random DOM poking from the plugin class.
- UI is decoration-first. Visual states come from classes via `DecorationSet` (placeholders, keyboard feedback, boundary highlights, etc.). NodeViews render structure; decorations toggle classes.
- Templating uses `htm` via our `html` helper from `$src/utils/domTemplates.ts`. No JSX, no VDOM. Tagged templates → direct DOM.
- The plugin class does orchestration only: selection checks, content extraction, transactions, streaming insertions, state flags.
- **Reuse primitives**: For common UI patterns (dropdowns, modals, tooltips), use or create reusable primitives in `primitives/` rather than duplicating code across plugins. Primitives exist outside the document schema as UI controls.
- Keep code small and obvious. If it feels like "framework", you're over-engineering it.

## Reusable Primitives (UI Controls Outside Document Schema)

The `primitives/` folder contains reusable UI components that exist outside the document schema and are never part of saved content.

### UI Controls vs Document Content

These primitives are presentational controls, not semantic content. Think toolbar buttons, editor controls, floating panels. These components:

- **Not in the schema** - No NodeSpec, no content type definition
- **Rendered directly to DOM** - Append to containers, no transactions needed
- **Zero document involvement** - Never serialized, never part of saved content
- **Simple state management** - Direct DOM manipulation or singleton coordinators, no decorations
- **Framework-agnostic** - Can be pure DOM with zero ProseMirror dependencies

### Available Primitives

- **`dropdown/`** - Dropdown menus with singleton state management (outside document schema)
  - Factory pattern: `createPureDropdown(config)` returns `{dom, update, destroy}`
  - State managed by infoBubbleStateManager for mutual exclusion (one open at a time)
  - Used by AI Chat Thread for model and context selection
  - Zero ProseMirror dependencies in the dropdown code itself
  - See `primitives/dropdown/README.md` for complete API reference and migration guide

### UI Controls vs Document Nodes

**Document Nodes** (semantic content):
```typescript
// Defined in schema
dropdown: { group: 'block', atom: true, attrs: {...} }

// Inserted via transactions
tr.insert(pos, schema.nodes.dropdown.create(...))

// Problems:
// - Renders in contentDOM (wrong location for UI controls)
// - State via decorations (complex, survives NodeView recreation)
// - Becomes part of document content
```

**UI Controls** (presentational, outside schema):
```typescript
// No schema definition
const dropdown = createPureDropdown({...config})

// Direct append
controlsContainer.appendChild(dropdown.dom)

// Benefits:
// - Renders exactly where appended
// - Simple state (direct or singleton)
// - Never part of document content
```

### When to Use Each Approach

Use **UI Controls** (outside schema) for:
- Toolbar buttons, controls, floating panels
- UI that should never be saved/serialized
- Controls that don't belong in document flow
- Simple open/close state

Use **Document Nodes** for:
- Semantic content (images, tables, custom blocks)
- Content that should be saved/serialized
- Elements that participate in document structure
- Content with complex nested schemas

### Using UI Controls in NodeViews

When building NodeViews that include UI controls outside the document schema:

```typescript
class MyNodeView implements NodeView {
  dom: HTMLElement
  controlsContainer: HTMLElement
  dropdown: { dom: HTMLElement; update: (v: string) => void; destroy: () => void }

  constructor(node: Node, view: EditorView, getPos: () => number) {
    // Create container structure
    this.dom = document.createElement('div')
    this.controlsContainer = document.createElement('div')
    this.dom.appendChild(this.controlsContainer)

    // Create dropdown outside document schema
    this.dropdown = createPureDropdown({
      id: `dropdown-${node.attrs.id}`,
      selectedValue: node.attrs.value,
      options: [...],
      onSelect: (value) => {
        // Update node attrs via transaction
        const pos = getPos()
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, null, { ...node.attrs, value })
        )
      }
    })

    // Append to controls container (NOT contentDOM)
    this.controlsContainer.appendChild(this.dropdown.dom)
  }

  update(node: Node) {
    // Update control when attrs change
    this.dropdown.update(node.attrs.value)
    return true
  }

  destroy() {
    // Clean up control
    this.dropdown.destroy()
  }

  // CRITICAL: Prevent NodeView recreation from control mutations
  ignoreMutation(mutation: MutationRecord): boolean {
    return this.controlsContainer.contains(mutation.target as Node)
  }
}
```

**Key points:**
1. UI controls appended to dedicated container, not contentDOM
2. `ignoreMutation()` prevents NodeView destruction when controls change
3. Control state updates via `update()` method, not recreating NodeView
4. Cleanup via `destroy()` method

When building new plugins, check if your UI needs match existing primitives before creating custom components.

## Plugin state & rendering: decorations vs chrome

### When to Use Decorations

**Decorations** are for **document-related visual states** that need to survive NodeView recreation:

- Placeholders for empty content
- Selection highlights or ranges
- Keyboard feedback on document nodes
- Boundary indicators for document blocks
- Syntax highlighting tokens
- Spell-check underlines

Decorations add CSS classes to document nodes without modifying the document itself.

### When to Use UI Controls (Outside Schema)

**UI controls** are for presentational elements that exist outside the document:

- Dropdowns, buttons, toolbars
- Floating panels, popovers
- Editor controls (not document content)
- Any UI that should never be serialized

State is managed directly (element properties) or via singleton coordinators (like `infoBubbleStateManager`), not decorations.

### Decoration Pattern (for document-related UI state)

When a NodeView needs transient visual states that must survive recreation:

- Create a shared `PluginKey` in its own module to avoid circular imports.
	- Example: `aiChatThreadPluginConstants.ts` exporting `AI_CHAT_THREAD_PLUGIN_KEY`.
- Store state in plugin state (e.g., `keyboardFeedback: Map<string, boolean>`).
- Update that state only via `tr.setMeta(...)` in response to UI events.
- Reflect state to the UI by generating decoration classes in `props.decorations`.
- In `NodeView.update(updatedNode, decorations)`, read the `decorations` parameter and toggle wrapper classes accordingly.
- Let SCSS show/hide/animate purely from classes. Avoid inline style switches.

### Minimal pattern (copy-paste friendly)

1) Shared key (in `yourPluginKey.ts`):

```ts
import { PluginKey } from 'prosemirror-state'
export const YOUR_PLUGIN_KEY = new PluginKey('yourPlugin')
```

2) NodeView dispatches intent:

```ts
const toggle = (threadId: string, isOpen?: boolean) => {
	const tr = view.state.tr.setMeta('toggleDropdown', { threadId, isOpen })
	view.dispatch(tr)
}
```

3) Plugin state.apply handles meta and updates a Map:

```ts
apply(tr, value) {
	const meta = tr.getMeta('toggleDropdown')
	let dropdownStates = value.dropdownStates
	if (meta) {
		dropdownStates = new Map(dropdownStates)
		const prev = dropdownStates.get(meta.threadId) || false
		dropdownStates.set(meta.threadId, typeof meta.isOpen === 'boolean' ? meta.isOpen : !prev)
	}
	// return new state with updated dropdownStates and updated decorations
}
```

4) Decorations emit visual state:

```ts
function createDropdownOpenDecorations(state, dropdownStates) {
	const decos = []
	state.doc.descendants((node, pos) => {
		if (node.type.name === 'aiChatThread') {
			if (dropdownStates.get(node.attrs.threadId) === true) {
				decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'dropdown-open' }))
			}
		}
	})
	return DecorationSet.create(state.doc, decos)
}
```

5) NodeView.update reads the `decorations` arg to mirror classes on its wrapper element:

```ts
update(updatedNode, decorations) {
	const hasOpen = Array.isArray(decorations) && decorations.some(d => {
		const cls = d?.spec?.attrs?.class || ''
		return String(cls).split(/\s+/).includes('dropdown-open')
	})
	dom.classList.toggle('dropdown-open', !!hasOpen)
	return true
}
```

6) SCSS controls visibility:

```scss
.thread-wrapper .submenu-wrapper { display: none; }
.thread-wrapper.dropdown-open .submenu-wrapper { display: block; }
```

Notes:
- If you must read plugin state in a NodeView, import only the shared `PluginKey` and call `YOUR_PLUGIN_KEY.getState(view.state)` to avoid circular imports of the plugin module itself.
- For advanced debugging, you can mirror small bits of plugin state onto `view` in `plugin.view.update` (e.g., `view.__dropdownStates = map`) and use it as a fallback in NodeViews. Keep it optional.

## External stores inside NodeViews

NodeViews can subscribe to app stores (e.g., a Svelte `documentStore`) to update text/icon labels. Keep it safe:

- Subscribe in the NodeView when you construct the DOM, update only local DOM refs (no ProseMirror transactions for visual text changes).
- Unsubscribe in `destroy()` and remove any global event listeners you attached (like `window.click`).

Example sketch:

```ts
const titleEl = dom.querySelector('.title')
const unsub = documentStore.subscribe(({ data }) => {
	titleEl.textContent = computeTitle(data.aiModel)
})

return {
	destroy() { unsub?.() }
}
```

## Templating & NodeViews

Import once and use everywhere:

```ts
import { html } from '$src/utils/domTemplates.ts'

const el = html`
	<div className="btn" onclick=${onClick}>
		<span innerHTML=${icon}></span>
	</div>
`
```

Rules of thumb:
- Use `className` and `innerHTML` in templates.
- Event handlers: `onclick`, `onmouseenter`, etc. Keep handlers stable, avoid recreating closures in tight loops.
- Styles: pass an object to `style=${{ ... }}` if needed. Keep it minimal; most styling belongs in SCSS.

## Decorations – the visual contract

We lean on decorations to flip visual states. The plugin sets classes; SCSS does the rest.

Common state classes we reuse:
- `.receiving`
- `.thread-boundary-visible`

Don't dump CSS into READMEs. Styles live next to the plugin in `.scss` files. Document which classes matter, not the whole stylesheet.

## Plugin responsibilities (what goes where)

Put this in the plugin class:
- Read selection / find active scope
- Extract content into a simple data shape
- Dispatch transactions to insert/update nodes
- Manage `DecorationSet` for visual states
- Wire external signals (e.g., streaming events)

Put this in a NodeView:
- Initial DOM via `html` templates
- Local event handlers (hover, click)
- Minimal DOM refs for dynamic updates
- Call `setNodeMarkup` if attributes need nudging (sparingly)

Avoid in NodeViews:
- Owning persistent UI state that must survive updates (use plugin state + decorations instead).
- Importing the plugin module directly for state (use a shared `PluginKey` module to read state).

## Minimal data flow

1) User input → plugin sets metadata on a transaction
2) Plugin gathers data (from the active container node) → calls your app
3) External events (like streaming) feed back → plugin inserts/updates nodes
4) Decorations update classes so CSS can react

The AI Chat Thread plugin is the reference implementation for this setup. See `aiChatThreadPlugin/README.md` for the real thing: node shapes, data events, and concrete templates.

Additional reference topics implemented there:
- Decoration-driven dropdown open/close state per thread
- Shared `PluginKey` module to avoid circular imports
- NodeView subscription to doc store to keep selection label/icon in sync

## Tips

- Keep NodeViews small. If a template grows too big, split helpers, but don't invent abstractions you don't need.
- Prefer attributes/classes over inline styles.
- If a behavior repeats across plugins, extract it as a utility. Otherwise, keep it local.
- Don't write history sections in READMEs. Keep it actionable.
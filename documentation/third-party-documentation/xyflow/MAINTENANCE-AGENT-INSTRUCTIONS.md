# Maintaining This Documentation

Instructions for keeping the xyflow documentation in sync with the vendored source at `packages-vendor/xyflow/packages/system/src/`.

## When to Update

Update this documentation whenever:

- The vendored `@xyflow/system` package is upgraded to a new version
- Lixpi's canvas integration (`services/web-ui/src/infographics/`) changes how it uses xyflow primitives
- A developer or agent notices that documented behavior no longer matches the source

## How to Detect Drift

### 1. Check the Version

Look at `packages-vendor/xyflow/packages/system/package.json` for the current version. The documentation was written against **v0.0.75**. If the version has changed, a full review pass is needed.

### 2. Compare Module Structure

The source modules map 1:1 to documentation files:

| Source Directory | Documentation File |
|------------------|--------------------|
| `xypanzoom/` | `src/pan-zoom.md` |
| `xydrag/` | `src/drag.md` |
| `xyhandle/` | `src/connections.md` |
| `xyresizer/` | `src/resize.md` |
| `xyminimap/` | `src/minimap.md` |
| `utils/edges/` | `src/edge-routing.md` |
| `styles/` + DOM conventions | `src/dom-contract.md` |
| `types/` + `constants.ts` | `src/types-and-constants.md` |
| `utils/` (general, graph, store, dom) | `src/utilities.md` |
| _(cross-cutting)_ | `overview.md` |

If a new top-level directory appears in the source (e.g., a new `xysomething/`), a new documentation file is needed in `src/`.

If a source directory is removed, the corresponding doc file should be deleted and references in `overview.md` and `documentation/features/CANVAS-ENGINE.md` removed.

### 3. Scan for Behavioral Changes

For each module, check these signals of meaningful change:

**XYPanZoom** — New filter conditions in `eventhandler.ts`, new zoom/pan modes, changes to the D3 zoom setup, new animation options, changes to the `XYPanZoomOptions` type.

**XYDrag** — Changes to `getDragItems`, new snap behaviors, new extent types beyond `'parent'` and coordinate extent, changes to auto-pan logic, new drag filter conditions.

**XYHandle** — Changes to `getClosestHandle` search algorithm, new connection modes beyond strict/loose, changes to validation flow, new connection lifecycle callbacks.

**XYResizer** — Changes to `getDimensionsAfterResize` constraint solver, new control positions, new boundary types, changes to child compensation logic.

**XYMinimap** — Changes to how minimap interactions map to main viewport operations, new interaction modes.

**Edge routing** — New path types beyond bezier/smoothstep/straight, changes to label position calculation, new routing parameters.

**DOM contract** — New CSS class conventions, z-index layer changes, new interaction opt-out classes (like `nopan`, `nowheel`), new CSS custom properties, changes to required DOM structure.

**Types** — New node/edge change types, new fields on `InternalNodeBase`, changes to the `Handle` type, new coordinate space concepts, new error message IDs in `constants.ts`.

**Utilities** — New coordinate conversion functions, changes to `adoptUserNodes` behavior, new spatial query functions, deprecated function removals.

### 4. Check Lixpi Integration

The documentation describes how Lixpi uses each module. Verify these integration points still hold:

- `WorkspaceCanvas.ts` — Where `XYPanZoom` is created and how viewport transforms are applied
- `WorkspaceConnectionManager.ts` — How connections are handled (two-tier system: XYHandle + menu)
- `ConnectorRenderer.ts` — How edges are rendered (D3 data joins, path functions used)
- Synthetic handle pattern — Whether Lixpi still defines handles programmatically rather than via DOM measurement

Search for `XYPanZoom`, `XYDrag`, `XYHandle`, `XYResizer`, `getBezierPath`, `adoptUserNodes` in `services/web-ui/src/infographics/` to find current usage sites.

## How to Update

### Principles

1. **Explain behavior, not code.** Never list function signatures or quote source code. The source is always available at `packages-vendor/xyflow/packages/system/src/`. The documentation exists to explain what things do, why, when to use them, and what gotchas to watch for.

2. **Document the mental model.** Each file should give the reader a framework for understanding the module — not a reference card. Think "how does this state machine work" not "here are all the parameters."

3. **Include Lixpi context.** Each file should explain how Lixpi uses that particular module, if it does. This bridges the gap between generic xyflow docs and our specific integration.

4. **Keep files focused.** Each file covers one module or concept. Don't merge them.

### Update Process

1. Read the current documentation file
2. Read the corresponding source module thoroughly
3. Identify what has changed in behavior — new capabilities, removed features, changed defaults, new constraints
4. Update the documentation to reflect the new behavior
5. If a concept that previously existed has been removed, remove it from the doc (don't leave stale sections)
6. If a new concept has been added, add a new section explaining it conceptually
7. Update `overview.md` if the change affects the high-level picture (new primitives, changed limitations, new wrapper features)
8. Update `documentation/features/CANVAS-ENGINE.md` if file names or the directory structure changes

### Adding a New Module

If xyflow adds a new top-level module:

1. Create `src/{module-name}.md` following the same style as existing files — mental model, lifecycle, behavior, gotchas, Lixpi usage
2. Add it to the Documentation Index table in `overview.md`
3. Add it to the directory tree in `documentation/features/CANVAS-ENGINE.md`

### Removing a Module

1. Delete the corresponding file from `src/`
2. Remove it from the Documentation Index table in `overview.md`
3. Remove it from the directory tree in `documentation/features/CANVAS-ENGINE.md`

## Files That Reference This Documentation

These files link to the xyflow docs and need updating if file names or structure change:

- `documentation/features/CANVAS-ENGINE.md` — Directory tree listing all xyflow doc files
- `documentation/third-party-documentation/xyflow/overview.md` — Documentation Index table with relative links to `src/` files

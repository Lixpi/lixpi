# Connector Primitive (Edges + Arrowheads Only)

Minimal, reusable arrowed line renderer. It draws edges (paths) and arrowhead / circle markers. Nothing else.

## What It Does (and Does NOT Do)

| Capability                | Status |
|---------------------------|--------|
| Render lines (paths)      | ✅     |
| Arrowhead markers         | ✅     |
| Circle markers            | ✅     |
| Dashed line support       | ✅     |
| Multiple path strategies  | ✅     |
| Node shape rendering      | ❌     |
| Text / icon / line content| ❌     |
| Layout / positioning UI   | ❌     |

If you need rectangles, icons, or labels: render them yourself elsewhere. This primitive only concerns the connection visuals.

## Design Philosophy

Ultra-thin, precise, graceful:

- Default stroke width: 1.2px (`.connector-edge`)
- Strong variant: 1.5px (`.connector-edge-strong`)
- Rounded caps & joins always
- Arrowheads sized in user space (independent of stroke width)
- Line ends terminate exactly at arrow base (no gap / overlap)
- No consumer overrides required for correctness

## Installation

Import the renderer and call it:

```typescript
import { createConnectorRenderer } from '$src/infographics/connectors/index.ts'

const connector = createConnectorRenderer({
  container: document.querySelector('.my-edge-layer')!,
  width: 360,
  height: 150
})
```

## API

### `createConnectorRenderer(config)`

Config:
```typescript
type ConnectorConfig = {
  container: HTMLElement
  width: number
  height: number
  instanceId?: string // optional unique ID for marker defs
}
```

Returns an object with:
```typescript
type ConnectorRenderer = {
  addEdge(edge: EdgeConfig): void
  updateEdge(id: string, updates: Partial<EdgeConfig>): void
  removeEdge(id: string): void
  clear(): void
  render(): void
  destroy(): void
  getEdge(id: string): EdgeConfig | undefined
}
```

### `EdgeConfig`

```typescript
type EdgeAnchor = {
  nodeId: string      // logical grouping ID (optional semantic grouping)
  position: 'left' | 'right' | 'top' | 'bottom' | 'center'
  t?: number          // Position along the side (0=start, 1=end, 0.5=center). Default: 0.5
  offset?: { x?: number; y?: number }
}

type EdgeConfig = {
  id: string
  source: EdgeAnchor
  target: EdgeAnchor
  pathType?: 'bezier' | 'straight' | 'smoothstep' | 'horizontal-bezier' | 'orthogonal'
  marker?: 'arrowhead' | 'arrowhead-muted' | 'circle' | 'none'
  markerStart?: 'arrowhead' | 'arrowhead-muted' | 'circle' | 'none'
  curvature?: number
  borderRadius?: number  // Corner rounding for 'orthogonal' paths (default: 8)
  lineStyle?: 'solid' | 'dashed'
  strokeWidth?: number
  strokeDasharray?: string
  className?: string // semantic extension (DON'T replace internal geometry classes)
}
```

### Flexible Anchor Positioning

By default, edges connect at the center of a node's side (t=0.5). Use the `t` parameter to position anchors anywhere along a side:

```typescript
// Connect from top portion of source to bottom portion of target
connector.addEdge({
  id: 'flexible-edge',
  source: { nodeId: 'A', position: 'right', t: 0.2 },  // Near top (20% from top)
  target: { nodeId: 'B', position: 'left', t: 0.8 },   // Near bottom (80% from top)
  pathType: 'orthogonal'
})
```

For left/right sides, `t=0` is top and `t=1` is bottom. For top/bottom sides, `t=0` is left and `t=1` is right.

### Add an Edge

```typescript
connector.addEdge({
  id: 'a-b',
  source: { nodeId: 'A', position: 'right', offset: { x: 2 } },
  target: { nodeId: 'B', position: 'left', offset: { x: -3 } },
  pathType: 'bezier',
  marker: 'arrowhead',
  className: 'my-semantic-edge',
  strokeWidth: 1.2
})

connector.render()
```

### Dashed Edge

```typescript
connector.addEdge({
  id: 'dash-example',
  source: { nodeId: 'X', position: 'right' },
  target: { nodeId: 'Y', position: 'left' },
  pathType: 'straight',
  lineStyle: 'dashed', // internally becomes 6 8 pattern unless strokeDasharray provided
  marker: 'none'
})
```

### Bidirectional

```typescript
connector.addEdge({
  id: 'bi',
  source: { nodeId: 'upstream', position: 'right' },
  target: { nodeId: 'downstream', position: 'left' },
  marker: 'arrowhead',
  markerStart: 'arrowhead-muted'
})
```

## Render Cycle

Call `render()` after adding / updating edges. Internally:

1. Clears groups
2. Rebuilds marker defs (only necessary types)
3. Recomputes each path
4. Applies markers + stroke styles

## CSS Contract (Internal Classes)

Do not override these for geometry:

| Class                         | Purpose |
|------------------------------|---------|
| `.connector-svg`             | Root SVG container |
| `.connector-edge`            | Base edge stroke (1.2px) |
| `.connector-edge-strong`     | Strong edge (1.5px) |
| `.connector-edge-muted`      | Muted color variant |
| `.connector-edge-inline`     | Inline heavier variant (2px) |
| `.connector-arrowhead`       | Arrowhead marker path |
| `.connector-arrowhead-muted` | Muted arrowhead path |
| `.connector-marker-circle`   | Circle marker |

You may append semantic classes via `className` (e.g. `className: 'my-edge connector-edge-strong'`) but SHOULD NOT remove the base internal class.

## Performance Notes

- Markers are created only for actually used types.
- Stroke width does not distort markers (userSpaceOnUse).
- Re-render cost proportional to edge count; avoid unnecessary `render()` calls.

## Extending

Add path types in `paths.ts`. Add markers in `markers.ts`. Keep sizing consistent (avoid coupling to stroke width).

## Philosophy Recap

This is NOT a diagram layout engine. It is a surgical tool for drawing connection strokes & arrowheads. Everything else (nodes, labels, interaction) lives outside.

## Credits

- XYFlow for path utilities
- D3 selection for DOM ops

## License

Internal project primitive; treat as stable for edge rendering concerns.

  return {
    id: `${instanceId}-diamond`,
    markerWidth: 10,
    markerHeight: 10,
    viewBox: '-5 -5 10 10',
    refX: 0,
    refY: 0,
    className: 'viz-marker-diamond',
    path: 'M 0,-3 L 3,0 L 0,3 L -3,0 Z'
  }
```

### Performance Considerations

- **Batch operations**: Add multiple nodes/edges before calling `render()`
- **Selective updates**: Use `updateNode`/`updateEdge` instead of remove + add
- **Memory**: Call `destroy()` when done to clean up event listeners and DOM

## Design Principles

1. **Declarative**: Define what you want, not how to render it
2. **Composable**: Nodes and edges are independent, reusable building blocks
3. **Framework-agnostic**: Works in any JavaScript environment
4. **Type-safe**: Full TypeScript support with comprehensive types
5. **Extensible**: Easy to add new path types, markers, and node shapes

## XYFlow Integration

This system wraps XYFlow's battle-tested edge utilities:

- `getBezierPath` — Curved edges with configurable curvature
- `getStraightPath` — Direct line connections
- `getSmoothStepPath` — Orthogonal routing with rounded corners

Additionally, custom path types are available:

- `horizontal-bezier` — Symmetric S-curve for horizontal flows
- `orthogonal` — Circuit board style: horizontal → vertical → horizontal with rounded corners (default for workspace edges)

All paths respect anchor positions (left, right, top, bottom) and compute proper control points automatically.

## Credits

Built on top of:
- [XYFlow](https://github.com/xyflow/xyflow) — React/Svelte flow library with excellent edge utilities
- [D3](https://d3js.org/) — The gold standard for SVG manipulation

Inspired by the XYFlow documentation structure and design patterns.

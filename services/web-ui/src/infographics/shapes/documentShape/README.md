# Document Shape Primitives

Reusable D3-based primitives for building document visualization components.

Inspired by: https://www.flaticon.com/free-icon/context_9874827
https://www.flaticon.com/authors/freepik
Premium Flaticon License issued to Shelby Carter


## File Structure

```
documentShape/
├── README.md                      # This file
├── index.ts                       # Exports all primitives
├── documentContentBlock.ts        # Lines + squares (top & bottom variants)
├── documentThreadShape.ts         # White rounded border + text
├── documentContextSelection.ts    # Animated gradient background
└── documentShape.ts               # Main composition - combines all primitives
```

## Components

### `documentContentBlock.ts`

Draws document content representation - combinations of lines and squares.

**API:**
```typescript
drawDocumentContentBlock(parent: D3Selection, config: {
  variant: 'top' | 'bottom'
})
```

**Variants:**
- `top`: Square on left + lines with gap + dots (rows above context)
- `bottom`: Lines with gaps + squares on right (rows below context)

**Usage:**
```typescript
import { drawDocumentContentBlock } from './documentShape'

drawDocumentContentBlock(svgGroup, { variant: 'top' })
drawDocumentContentBlock(svgGroup, { variant: 'bottom' })
```

---

### `documentThreadShape.ts`

Draws white rounded border rectangle with centered text label. **Owns its gradient setup and animation logic.**

**API:**
```typescript
// Draw the thread shape
drawDocumentThreadShape(parent: D3Selection, config: {
  text: string
  gradientId?: string  // Optional: gradient ID for stroke (instead of white)
  colors?: string[]    // Optional: colors for gradient (not used directly, for reference)
})

// Setup the gradient definition
setupThreadGradient(defs: D3Selection, config: {
  gradientId: string
})

// Animate the gradient
startThreadGradientAnimation(
  container: HTMLElement,
  nodeId?: string,         // default: 'context'
  duration?: number,       // default: 50ms (smooth rotation steps)
  threadGradientId?: string  // default: 'ctx-thread-grad'
): { stop: () => void }
```

**Features:**
- Default: white stroke
- With `gradientId`: applies animated rotating gradient to stroke
- Gradient rotates counterclockwise around the border creating a flowing snake effect
- Uses blue-dominant color palette with purple accents

**Usage:**
```typescript
import {
  drawDocumentThreadShape,
  setupThreadGradient,
  startThreadGradientAnimation
} from './documentShape'

// In SVG defs section
setupThreadGradient(defs, { gradientId: 'my-thread-grad' })

// Draw the thread shape
drawDocumentThreadShape(svgGroup, {
  text: 'THREAD',
  gradientId: 'my-thread-grad'
})

// Start animation after DOM insertion
const animation = startThreadGradientAnimation(
  containerElement,
  'my-node-id',
  50,
  'my-thread-grad'
)

// Stop when needed
animation.stop()
```---

### `documentContextSelection.ts`

Handles animated gradient background for context selection.

**API:**
```typescript
// Setup gradient definition in SVG defs
setupContextGradient(defs: D3Selection, config: {
  gradientId: string
  colors?: string[]  // default: ['#a78bfa', '#60a5fa', '#a78bfa']
})

// Draw gradient-filled rectangle
drawContextSelection(parent: D3Selection, config: {
  gradientId: string
})
```

**Usage:**
```typescript
import { setupContextGradient, drawContextSelection } from './documentShape'

// In SVG defs section
setupContextGradient(defs, { gradientId: 'ctx-grad' })

// In SVG content
drawContextSelection(svgGroup, { gradientId: 'ctx-grad' })
```

---

### `documentShape.ts`

Main composition that combines all primitives to create the complete context visualization.

**API:**
```typescript
// Create complete context shape SVG
createContextShapeSVG(): string

// Start gradient animation (background and/or thread stroke)
startContextShapeAnimation(
  container: HTMLElement,
  nodeId?: string,              // default: 'context'
  duration?: number,             // default: 1500ms
  gradientId?: string,           // default: 'ctx-grad'
  animateThreadGradient?: boolean, // default: false - animate thread stroke
  threadGradientId?: string      // default: 'ctx-thread-grad'
): { stop: () => void }
```

**Usage:**
```typescript
import { createContextShapeSVG, startContextShapeAnimation } from './documentShape'

// Create SVG markup
const svgString = createContextShapeSVG()

// Start animation after DOM insertion
// Animates both background and thread stroke gradients
const animation = startContextShapeAnimation(
  containerElement,
  'my-node-id',
  1500,
  'ctx-grad-my-node-id',
  true,  // Enable thread gradient animation
  'ctx-thread-grad-my-node-id'
)

// Stop animation when needed
animation.stop()
```

---

## Design Principles

1. **Modularity**: Each primitive is self-contained and reusable
2. **Composition**: Primitives can be combined to create complex visualizations
3. **Exact Positioning**: All coordinates are explicit for pixel-perfect rendering
4. **D3 Native**: Uses standard D3 patterns with chained attribute setters
5. **No Abstractions**: Direct SVG element creation without unnecessary wrappers

## Visual Structure

```
┌─────────────────────────────────┐
│  ■ ─────  ─────────────  • • •  │  ← Top content block
│  ──────────────────────────────  │
├─────────────────────────────────┤
│  ╔═══════════════════════════╗  │
│  ║       CONTEXT             ║  │  ← Thread shape + Context selection
│  ╚═══════════════════════════╝  │
├─────────────────────────────────┤
│  ─────  ─────────                │  ← Bottom content block
│  ──  ────────────         ■ ■ ■  │
└─────────────────────────────────┘
```

# Canvas Engine

`@lixpi/canvas-engine` is the shared workspace-canvas engine package. It holds canvas logic that needs to run outside a single application surface, starting with geometry and collision behavior used by the API canvas projection path.

The package is intentionally split by runtime boundary:

```text
src/
  shared/      Rendering-agnostic code. Safe in API, workers, tests, and browser code.
  backend/     Server-side adapters and orchestration helpers. No DOM, Svelte, PIXI, or browser APIs.
  frontend/    Browser-side adapters. No web-ui imports or Svelte components.
    animation/ Shared animation timing utilities.
    rendering/ Actual rendering modules. DOM, PIXI, canvas, and SVG drawing code belongs here.
```

The package root exports the shared rendering-agnostic surface directly:

```typescript
import { resolveRigidCanvasNodeGroupCollisions } from '@lixpi/canvas-engine'
```

Runtime-specific imports should use subpath exports:

```typescript
import { resolveRigidCanvasNodeGroupCollisions } from '@lixpi/canvas-engine/backend'
import { resolveRigidCanvasNodeGroupCollisions } from '@lixpi/canvas-engine/frontend'
```

There are no implementation modules directly under `src`. New code belongs under `shared`, `backend`, or `frontend` according to its runtime boundary.

## Runtime Boundaries

### `src/shared`

Use `shared` for deterministic data transforms and geometry algorithms:

- plain TypeScript types;
- rectangle and point math;
- collision resolution;
- layout planning that accepts plain data and returns plain data;
- canvas-node data transforms that do not require rendering objects.

Shared modules must not import DOM APIs, Svelte stores, PIXI, browser globals, requestAnimationFrame, NATS clients, DynamoDB clients, or workspace service singletons. They can import shared data types from packages such as `@lixpi/constants` when the type is part of the cross-runtime canvas contract.

### `src/backend`

Use `backend` for API or worker code that needs canvas-engine behavior but still has server-side concerns:

- API canvas projection adapters;
- persistence-facing layout adapters;
- migration and normalization helpers;
- server-side validation around canvas state.

Backend modules can re-use `shared`, but must not depend on rendering. Backend code should return updated canvas data, not DOM instructions.

### `src/frontend`

Use `frontend` for browser-only canvas orchestration that does not directly render pixels:

- viewport adapters;
- UI state adapters;
- pointer or keyboard interaction planning;
- web-ui integration helpers.

Frontend modules can depend on browser concepts when needed. They must not import `services/web-ui` modules or Svelte components. Keep pure data logic in `shared` instead.

### `src/frontend/animation`

Use `frontend/animation` for reusable animation timing code:

- easing curves;
- duration-independent transition math;
- browser-safe animation helpers that do not own DOM or PIXI objects.

Animation modules can be used by rendering code, but should stay independent from app settings and concrete UI elements.

### `src/frontend/rendering`

Use `frontend/rendering` for modules that produce or mutate visible output:

- PIXI renderers;
- DOM/SVG canvas chrome;
- animation loops;
- measuring rendered elements.

Rendering modules can consume `shared` plans, but shared/backend modules must never import rendering modules.

## Existing Shared Modules

- `shared/geometry`: minimal point and rectangle types shared by collision and canvas-node adapters. Keep executable algorithms in the domain modules that own them.
- `shared/collision`: geometry-agnostic rectangle collision resolver.
- `shared/canvas-node`: adapters that apply shared collision output to canvas-node groups.
- `shared/tree-layout`: geometry-agnostic tidy-tree layout for abstract node boxes.
- `shared/zoom-scaling`: deterministic bounded zoom-scaling helpers for canvas chrome.
- `frontend/animation`: shared easing curves used by Canvas, PIXI, and SVG transitions.
- `frontend/connectors`: frontend-only connector path helpers. These depend on `@xyflow/system`, emit SVG path strings, and are not backend-safe shared geometry.
- `frontend/rendering/gradients`: freeform, shifting, and SVG gradient renderers.
- `frontend/rendering/glass`: PIXI glass material and glass border renderers.
- `frontend/rendering/progress`: traveling outline renderer used by workspace progress indicators.

The collision flow is:

1. caller converts runtime-specific entities into plain `CollisionBox` or `RigidCanvasNodeGroup` data;
2. `shared/collision` computes moved rectangle positions;
3. `shared/canvas-node` translates group movement back onto `CanvasNode.position`;
4. caller persists, renders, or otherwise applies the returned nodes.

## Rules for New Modules

- Put reusable data algorithms in `shared` first.
- Put API-only orchestration in `backend`.
- Put browser orchestration in `frontend`.
- Put DOM/PIXI/canvas/SVG drawing in `frontend/rendering`.
- Do not import `services/web-ui` modules from this package.
- Keep package-root exports stable and small; prefer explicit subpath exports for runtime-specific surfaces.
- Do not add rendering imports to `shared` or `backend`.
- Do not add new implementation directories directly under `src`; choose `shared`, `backend`, or `frontend`.

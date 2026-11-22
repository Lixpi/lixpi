# Branch marker diagrams

A page that explains a workflow can draw it with the same branch markers and connectors people see in a Lixpi workspace. The diagram is an ordinary `CanvasController` scene. It has no separate diagram canvas, and it creates no persisted generation or conversation nodes. The engine's [graph layout](../../../canvas-engine/docs/GRAPH-LAYOUT.md) places the markers and routes the connectors, and the controller's presentation flags lock, fit and scroll it like any other canvas.

The workspace supplies four pieces:

- `createBranchMarkerNode(id, { prompt, response, role })` from `/workspace/shared` measures the native pill with `estimateBranchMarkerDimensions`, including the optional response line, and gives it centered side ports. The role is `origin`, `fork` or `continuation`. It selects the branch shell and arrow rules; it does not claim a backend generation state.
- `createBranchMarkerEdge(id, source, target, kind)` creates a forward, relation or feedback edge whose data carries its kind.
- `createBranchMarkerGraphLayout(stages)` returns layout options with the workspace's marker clearance, branch row gap and branch-origin collision policy. Media-to-media spacing does not apply to marker-only graphs.
- `createBranchMarkerNodeRegistration()` from `/workspace/nodes` mounts `BranchMarkerNodeView`, which draws the workspace shell and `BranchMarkerContent` from the prompt and response text. `createBranchMarkerConnectionPolicy()` from `/workspace/connectors` keeps lineage ports centered and applies the workspace arrow rules: forward connectors into fork and continuation markers are arrowless, while origin targets, relations and feedback keep the native arrow.

```typescript
import {
    CanvasController,
    NodeRegistry,
} from '@lixpi/canvas-engine/frontend/runtime'
import {
    arrowRightMarkerBodyLengthFraction,
    createArrowRightMarker,
} from '@lixpi/ui-kit/svg'
import {
    createBranchMarkerEdge,
    createBranchMarkerGraphLayout,
    createBranchMarkerNode,
} from '@lixpi/canvas-components/workspace/shared'
import { createBranchMarkerNodeRegistration } from '@lixpi/canvas-components/workspace/nodes'
import { createBranchMarkerConnectionPolicy } from '@lixpi/canvas-components/workspace/connectors'
import {
    applyWorkspaceCanvasTheme,
    createLixpiCanvasSettings,
    resolveLixpiCanvasTheme,
} from '@lixpi/canvas-components/workspace/settings'

const settings = resolveLixpiCanvasTheme(theme.value, createLixpiCanvasSettings())
applyWorkspaceCanvasTheme(host, settings)

const canvas = new CanvasController({
    root: host,
    registry: new NodeRegistry().register(createBranchMarkerNodeRegistration()),
    scene: {
        sceneKey: 'experiments',
        revision: '1',
        nodes: [
            createBranchMarkerNode('control', { prompt: 'Shared control', role: 'origin' }),
            createBranchMarkerNode('a', { prompt: 'Comparison A', role: 'fork' }),
            createBranchMarkerNode('b', { prompt: 'Comparison B', role: 'fork' }),
            createBranchMarkerNode('review', { prompt: 'Review evidence', role: 'origin' }),
        ],
        edges: [
            createBranchMarkerEdge('control-a', 'control', 'a'),
            createBranchMarkerEdge('control-b', 'control', 'b'),
            createBranchMarkerEdge('a-review', 'a', 'review'),
            createBranchMarkerEdge('b-review', 'b', 'review'),
            createBranchMarkerEdge('review-control', 'review', 'control', 'feedback'),
        ],
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    connectors: {
        settings: settings.connector,
        renderer: { marker: createArrowRightMarker() },
        markerBodyLengthFraction: arrowRightMarkerBodyLengthFraction,
        policy: createBranchMarkerConnectionPolicy(),
    },
    layout: createBranchMarkerGraphLayout([
        { trees: [{ rootId: 'control', children: { control: ['a', 'b'] } }] },
        { trees: [{ rootId: 'review' }] },
    ]),
    locked: true,
    autoFit: true,
    scrollCapture: 'on-activate',
    onIntent: acceptIntent,
    onError: reportError,
})
```

The host element needs a position and an explicit size, as for any canvas. The workspace stylesheets that already style branch markers, `/styles/workspace/nodes` and `/styles/workspace/branch-marker`, style these markers too. `applyWorkspaceCanvasTheme` writes the branch palette onto the host; call it again with the resolved settings, and pass `settings.connector` to `setConnectionSettings`, when the canvas theme changes. Send a new scene to `setScene` when text or edges change; the layout and, with `autoFit`, the fitted viewport follow it.

Markers are movable. A locked canvas or an active layout keeps them in place. With the layout turned off on an unlocked canvas, markers drag like any other node, and the geometry intent the controller emits when the layout is removed lets the host keep the arranged positions.

The documentation service's Diagrams page shows this composition with relation and feedback edges and the shared canvas controls.

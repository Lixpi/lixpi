# Embedded native diagrams

`/workspace/diagram` exports `WorkspaceDiagramCanvas` and its factory, `createWorkspaceDiagramCanvas`. This presentation uses the workspace's branch pill shell, `BranchMarkerContent`, theme, text measurement, connector artwork, endpoint policy and connection settings. It does not create persisted generation or conversation nodes.

Import `/styles/workspace/diagram` once, give the canvas a sized host, append `el`, and call `mount()`. Pass content and semantic relationships through `setDiagram()`; destroy the canvas when its host unmounts.

```typescript
import {
    createWorkspaceDiagramCanvas,
} from '@lixpi/canvas-components/workspace/diagram'
import '@lixpi/canvas-components/styles/workspace/diagram'

const canvas = createWorkspaceDiagramCanvas({
    ariaLabel: 'Parallel experiments with shared controls',
    sceneKey: 'experiments',
    onError: reportError,
})

host.append(canvas.el)
canvas.setDiagram({
    revision: 'initial',
    nodes: [
        { id: 'control', prompt: 'Shared control', role: 'origin' },
        { id: 'a', prompt: 'Comparison A', role: 'fork' },
        { id: 'b', prompt: 'Comparison B', role: 'fork' },
        { id: 'review', prompt: 'Review evidence', role: 'origin' },
    ],
    stages: [
        { trees: [{ rootId: 'control', children: { control: ['a', 'b'] } }] },
        { trees: [{ rootId: 'review' }] },
    ],
    edges: [
        { id: 'control-a', source: 'control', target: 'a' },
        { id: 'control-b', source: 'control', target: 'b' },
        { id: 'a-review', source: 'a', target: 'review' },
        { id: 'b-review', source: 'b', target: 'review' },
    ],
})
canvas.mount()
```

Nodes provide a prompt, an optional short response line and a presentation role: `origin`, `fork` or `continuation`. Native marker dimensions come from `estimateBranchMarkerDimensions`, including the response line. These roles select the actual branch shell and marker policy; they do not claim a backend generation state. Forward connectors into fork and continuation markers are arrowless, just as they are in the workspace. Origin targets, relations and feedback use the native arrow artwork and its body-length compensation so their direction remains explicit.

Stages define reading order. Each stage contains one or more real fan-out trees. Every tree relationship must also be declared as a forward edge, every node belongs to one tree, and sibling arrays preserve their supplied order. A shared result is a separate root; incoming joins remain edges rather than assigning that result to an arbitrary parent. A stage may provide `alignNodeId` to align a member marker with the other stages' horizontal reading line. The layout expands the stage's virtual envelope symmetrically around that marker, then places the whole stage through the native tree and collision algorithms. The anchor must belong to its stage.

`layoutWorkspaceDiagram` is exported from `/workspace/shared/diagram` for non-DOM consumers. It measures the native pills, calls the engine's `layoutTree` for each fan-out, composes invisible tree and stage envelopes with that same algorithm, and resolves their collisions as rigid groups through `resolveCollisions`. Marker clearance and sibling spacing come from the native layout constants. Media-to-media spacing is not used for marker-only diagrams. The result contains the scene and its measured bounds. Hosts supply no coordinates, node dimensions, ports or waypoints.

Forward edges use the workspace's horizontal Bézier path and centered lineage ports. Relation targets receive separate directional ports; a relation may share an existing forward output when it leaves the same source in the same direction. Relations choose their facing sides from the dominant geometric axis. When a horizontal target side is occupied and the source centerline has enough vertical clearance from the target, the relation keeps its source side and approaches the target from the facing top or bottom port. Vertical relations align their anchors when there is an available shared horizontal coordinate. The shared engine point planner uses the same obstacle solver for horizontal, paired vertical and mixed port directions. Relations retain its computed bend points, reserving at least the native marker gap for outward endpoint leads so bounded zoom-dependent gaps and arrow compensation stay on those leads.

Feedback uses exterior horizontal lanes, placing longer spans farther outside the node and relation bounds. The shared planner reserves forward Bezier hulls, relation segments and previously accepted feedback routes, then checks complete escape pairs on both sides with the engine's orthogonal clearance and route-simplicity helpers. A vertical exit can turn through a clear gap between rows before passing around a blocking node to reach the exterior lane; candidate turns and corridors come from the node and connector bounds. Its conservative hulls include the native bounded endpoint offsets, while connector clearance covers native arrow width, stroke and corner rounding. Free ports and corridor boundaries are evaluated in a stable order; edge declaration order does not change the selected geometry. Clear centered ports take priority, then route length selects among the available candidates. This finite, conservative search does not promise a globally shortest route. A blocked return reports an error instead of using a known crossing. Feedback ports remain distinct from centered forward ports. Same-direction fan-out can share a forward source anchor without creating an opposing junction. The layout translates nodes and route points together, so all coordinates and exterior lanes remain within the returned fit bounds. Routing does not change the tidy-tree offsets or the collision-resolved stage positions. Hosts supply semantic edges without authored waypoints.

The native orthogonal router validates complete local detours and expands blocker envelopes when a later leg enters another node. It is not a general maze solver. An exhausted local route reports a typed error through the canvas error callback instead of painting a known node crossing; the semantic edge remains in the scene. Feedback reservations prevent a selected return from traversing the existing connector corridors. They do not make arbitrary graphs planar: cross-stage relations can still cross other forward or relation edges, and the finite exterior-route search can reject a graph that requires a more complex detour.

The canvas fits the complete measured diagram inside its host on mount, resize and diagram revision. Native connector scaling uses that fitted viewport zoom, so node geometry, arrow artwork, endpoint gaps and strokes remain coordinated. Pan and zoom remain available for inspecting details. The generic embedded canvas owns page-scroll arming, fitting, resize observation and teardown; the Lixpi adapter owns its presentation and scene composition. Scientific illustrations such as IDBD continue to opt into their separate, explicit scientific connector settings and node content.

---
title: Nodes, ports and connectors
description: Named ports, gesture admission, routing, connector geometry and host-owned edge state.
---

# Nodes, ports and connectors

An edge joins named ports on two nodes. The engine owns connection input, geometry, hit testing and rendering. Edge meaning and persistence belong to the host.

A node's `ports` array declares an ID, input/output role, side and local anchor coordinates. Explicit ports support all four sides. Structural adapters may use the default left/right projection. Keep port coordinates synchronized with node dimensions after resize, as shown in the [engine-only example](../examples/engine-only.ts).

## Connection lifecycle

`CanvasController` installs connectors when supplied explicit settings and an optional policy. The lower-level `ConnectionManager` accepts root/viewport elements, graph projections, settings and callbacks. Every instance has a separate flow identity.

Handle input starts a transient connection. Pointer movement tracks eligible targets and temporary geometry; completion reports a connect or reconnect intent. Roles remain input/output even when dragging from an input. Invalid self-links and duplicates are rejected. Menu-driven connection initiation uses the same owner; proximity connection is disabled unless its policy permits candidates.

Escape, blur, source removal, explicit cancellation and destruction end a gesture without treating it as a drop in empty space. A real reconnect dropped in empty space removes that edge. Auto-pan work is cancelled with the gesture; a late pan response cannot restart it.

Handle dragging activates after movement exceeds one screen pixel. It searches within 30 world units, then gives a direct DOM hit precedence. A rejected candidate remains distinct from empty space. Auto-pan uses a 40-screen-pixel edge zone and a maximum 15-screen-pixel step, with one pending pan at a time. Menu connections wait for movement before drawing and suppress the completion click's competing node handlers.

## Port geometry and DOM identity

`ConnectionGeometry` validates and stages each snapshot before replacing its lookup. Parents resolve before children even when input order differs. Coordinate extents clamp local positions using node dimensions, then parent offsets produce world bounds. An extent of `parent` clamps against the resolved parent's rectangle. The projection does not mutate caller nodes or emit parent growth changes; `expandParent` remains accepted input metadata.

Explicit anchors are local world coordinates. A `both` port produces separate source and target entries at the same center. `ports: []` means no ports. Without a ports array, the structural projection creates left target and right source rectangles of size 10 by 10. Their top-left positions are the side midpoints, so drag centers include a five-unit offset on both axes. Menu snapping uses the unshifted side midpoint.

`CanvasController` supplies world-space connector footprints with parent links cleared. It keeps content roots for content-anchor policies even when those roots differ from the connector footprint. Do not add parent offsets to this projection again.

`PortMeasurement` is the lower-level DOM fallback. It receives zoom explicitly and refreshes ports when positive element dimensions differ from the snapshot's recorded dimensions. Handle positions use bounding-rectangle differences divided by zoom; sizes use unscaled element offsets. It does not discover zoom from computed CSS transforms.

`NodeHandles` writes `.canvas-port` elements with `data-canvas-owner-id`, `data-canvas-node-id`, `data-canvas-port-id`, `data-canvas-port-role` and `data-canvas-port-direction`. Hit lookup requires both pane containment and the manager's owner ID. A DOM port from another pane cannot be adopted just because node and port IDs match. Consumers normally supply scene ports; lower-level DOM integrations must use this identity contract.

Transient sessions contain a start port, an optional candidate, validity, a pane-local pointer and a world pointer. Rendering uses the candidate's world center or the world pointer. Graph snapshots cache resolved port centers so pointer movement does not rebuild the graph.

## Routing and coordinates

[Shared path helpers](../src/shared/connectors/paths/index.ts) support the exported path families; [ELK routing](../src/frontend/connectors/elkRouting.ts) provides obstacle-aware routing utilities. Connection settings select the line curve, sizes, snap distances, alignment thresholds and colors.

Connector spread policies can center endpoints, auto-align eligible targets or spread anchors near corners. Product-specific source content can return a finite `sourceAnchorT` to override the vertical anchor on left/right ports. Returning null or a nonfinite value retains the configured port; top/bottom ports keep their explicit coordinates.

Geometry and paint use different size spaces. Marker offsets and invisible hit widths are world-space geometry. Connector data carries base screen-pixel stroke and marker sizes; `ConnectorRenderer` projects paths and applies bounded screen scaling once. Do not divide those sizes by zoom again.

The manager caches flattened paths for hit testing and midpoint anchoring. `getEdgeMidpointRect` lets a host position a menu without querying renderer internals. Selected edges and transient/proximity edges can use distinct colors, markers and dash patterns through explicit settings.

Connector callers import path functions and types directly from their shared definitions. `computePath` returns the SVG path plus label X/Y and source offsets. Straight labels use the endpoint midpoint. Bezier labels use the cubic point at parameter 0.5; forward controls use half the axis distance, while backward controls use `curvature * 25 * sqrt(-distance)`. Directional paths map `center` to `bottom`.

Smoothstep handles opposite, equal and mixed sides, corrects short gaps, removes duplicate bend points and limits rounded corners to adjacent half-segment lengths. Its dispatcher fixes the gap at 20 and radius at 8. Labels prefer the longest routing segment; its returned offsets are half the endpoint displacement. The custom `horizontal-bezier` path and `orthogonal` obstacle, bend-point and lane rules remain separate path families.

## Rendering and state

`ConnectorRenderer` draws neutral paths through a drawing scope. Entries retain resource allocations and compare render signatures so unchanged edges do not rebuild their path resources. Removing an edge releases its allocation. No component receives a Pixi Graphics object.

Clicking selects an edge. Escape or background interaction deselects it; keyboard deletion emits a host intent while respecting editable content and the active canvas. The host may compose a generic menu from its own UI library. The engine does not contain menus, icons, product labels or persistence transport.

Apply accepted edge changes through `setScene`. Reconcile authoritative state with the host's revision policy; do not make rendering callbacks write to a global store.

## Extending behavior

Use connection policies for domain-specific admission, centered anchors, source-content alignment, target markers and proximity eligibility. Keep branch lineage, message identifiers and AI context semantics outside the engine. [Rendering resources](RENDERING-RESOURCES.md) covers the drawing contract; [rendering lifecycle](RENDERING-ENGINE.md) covers scope disposal.

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

Engine-managed handles include the low-level attributes required by the XYFlow geometry adapter. Consumers should register ports rather than reconstructing that DOM contract. See the [dependency reference](xyflow/src/connections.md) when changing the adapter itself.

## Routing and coordinates

[Path helpers](../src/frontend/connectors/paths.ts) support the exported path families; [ELK routing](../src/frontend/connectors/elkRouting.ts) provides obstacle-aware routing utilities. Connection settings select the line curve, sizes, snap distances, alignment thresholds and colors.

Connector spread policies can center endpoints, auto-align eligible targets or spread anchors near corners. Product-specific source content can return a finite `sourceAnchorT` to override the vertical anchor on left/right ports. Returning null or a nonfinite value retains the configured port; top/bottom ports keep their explicit coordinates.

Geometry and paint use different size spaces. Marker offsets and invisible hit widths are world-space geometry. Connector data carries base screen-pixel stroke and marker sizes; `ConnectorRenderer` projects paths and applies bounded screen scaling once. Do not divide those sizes by zoom again.

The manager caches flattened paths for hit testing and midpoint anchoring. `getEdgeMidpointRect` lets a host position a menu without querying renderer internals. Selected edges and transient/proximity edges can use distinct colors, markers and dash patterns through explicit settings.

## Rendering and state

`ConnectorRenderer` draws neutral paths through a drawing scope. Entries retain resource allocations and compare render signatures so unchanged edges do not rebuild their path resources. Removing an edge releases its allocation. No component receives a Pixi Graphics object.

Clicking selects an edge. Escape or background interaction deselects it; keyboard deletion emits a host intent while respecting editable content and the active canvas. The host may compose a generic menu from its own UI library. The engine does not contain menus, icons, product labels or persistence transport.

Apply accepted edge changes through `setScene`. Reconcile authoritative state with the host's revision policy; do not make rendering callbacks write to a global store.

## Extending behavior

Use connection policies for domain-specific admission, centered anchors, source-content alignment, target markers and proximity eligibility. Keep branch lineage, message identifiers and AI context semantics outside the engine. [Rendering resources](RENDERING-RESOURCES.md) covers the drawing contract; [rendering lifecycle](RENDERING-ENGINE.md) covers scope disposal.

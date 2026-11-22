---
title: Graph Layout
description: How the canvas places nodes from fan-out trees and routes forward, relation and feedback edges without host coordinates.
---

# Graph Layout

Some canvases show a process rather than a workspace someone arranged by hand. For example, a page might explain that a shared control fans out into two comparisons, both feed a review, and the review loops back to the start. Writing coordinates, ports and waypoints for that picture is slow, and the picture breaks when a label grows. The graph layout lets a host describe the graph and leaves placement and routing to the engine.

`layoutCanvasGraph(scene, options)` from `@lixpi/canvas-engine/shared` returns the arranged scene and its bounds. `CanvasController` runs the same function when its `layout` option or `setLayout()` supplies the options, so the controller's own canvas, interaction, lock and fit behavior apply to the arranged scene. The [Canvas Engine README](../README.md) describes those controller flags.

## What the host supplies

Nodes keep their type, data and dimensions. Their sizes come from the scene, so a registration's own text measurement decides how much room each node gets. Positions, ports and edge routes in the supplied scene are replaced. Every node must be top level, because a parent-relative position cannot be placed in a shared graph.

Each edge has a kind, which `edgeKind(edge)` reads from the edge. Without the callback, every edge is a forward edge.

- A forward edge belongs to a fan-out and draws a horizontal Bézier from the source's right side to the target's left side.
- A relation connects nodes in different trees or columns with an orthogonal route between its own ports.
- A feedback edge returns to an earlier node through a lane outside the diagram.

Stages define reading order from left to right. Each stage holds one or more trees, and each tree lists its root and the children of each parent in display order. Every tree relationship must also exist as a forward edge, and each node belongs to exactly one tree. A shared result, such as a review that two comparisons feed, is its own root; its incoming edges remain edges instead of assigning it to an arbitrary parent. A stage's `alignNodeId` puts one of its nodes on the horizontal reading line shared with the other stages.

When the host omits `stages`, every node that no forward edge enters roots a tree in one stage, and each node joins the first tree that reaches it.

`spacing` sets the clearance around nodes, the gap between sibling subtrees and the collision policy. Depth columns sit two node gaps apart. The defaults suit generic boxes; a host whose nodes come from a product layout passes that product's values, as the Lixpi branch markers do.

## How placement works

Each tree goes through the engine's tidy-tree layout. The trees of a stage, and then the stages themselves, are composed as invisible rigid envelopes with the same tree algorithm, and the collision resolver separates those envelopes without changing the tree offsets inside them. An aligned stage expands its envelope symmetrically around the aligned node so the shared solvers can line it up without breaking the stage apart.

Every placed node gets centered `left`, `right`, `top` and `bottom` ports; `createCanvasSidePorts(size)` creates the same set for a host that builds its scene before layout.

## How routing works

Forward edges keep the centered lineage ports. Fan-outs share the source's right port and joins share the target's left port, so ordinary lineage looks the same as in the workspace.

Relations take separate ports on the sides that face each other along the dominant axis. When the facing horizontal side of the target is already taken and the source sits clear of the target vertically, the relation keeps its source side and enters the target from the top or bottom instead. A relation can reuse its source's forward output when it leaves in the same direction, and vertical relations align their two anchors when there is room. The shared orthogonal planner routes the relation and keeps at least one node gap of lead at each endpoint, so connector gaps and arrow compensation stay on those leads.

Feedback edges are routed last. Shorter returns take inner lanes and longer ones take outer lanes, above or below the diagram. The router reserves every forward hull, relation segment and earlier feedback route, then tries complete pairs of escapes from both ends on both sides. An escape may first turn through a clear gap between rows before reaching its lane. A candidate is accepted only when it is a simple orthogonal route that clears all other nodes and keeps half a node gap from reserved connectors. Centered ports win over off-center ports, and route length breaks ties. Candidates are enumerated in a fixed order, so reversing the input edge order produces the same geometry.

The search is finite and conservative. It does not promise the shortest route, and it is not a general maze solver. When no clear route exists, layout throws an error instead of drawing a route through a node. Relations from different stages can still cross other connectors; the router keeps feedback off existing corridors but does not make arbitrary graphs planar.

After routing, nodes and route points move together so the content starts one node gap from the origin. The returned bounds include that margin on every side.

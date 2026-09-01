---
title: Collision resolution
description: Pure rectangle separation, measured node bounds and rigid tree or group movement.
---

# Collision resolution

`resolveCollisions` separates rectangular boxes without knowing node types, rendering, persistence or product lineage. Import it from `@lixpi/canvas-engine/shared`. A caller converts its objects to world-space boxes, supplies exclusions and constraints, and applies the resulting positions.

## Resolver contract

Each box supplies `id`, `x`, `y`, `width` and `height`. Optional `fixed`, `margin` and `overlapThreshold` override movement and spacing per box. Options supply iteration limits, defaults, excluded pairs and a `shouldResolvePair` predicate. See [types](../src/shared/collision/types.ts) and [implementation](../src/shared/collision/resolve-collisions.ts).

The resolver expands boxes by their margins, checks pairs, and separates overlapping pairs on the smaller penetration axis. Both movable boxes share the displacement; a fixed box makes the other box take the full displacement. Two fixed boxes stay put. The narrower per-box overlap threshold governs the pair. Exclusions are checked before the geometric predicate.

The default limit is 50 iterations, margin 20 and overlap threshold 0.5. Nonfinite values are normalized and negative dimensions, margins and thresholds are clamped. The pair loop is quadratic per iteration. Iteration limits and fixed constraints mean callers must not assume every input becomes overlap-free.

The result includes a map containing only moved positions, the number of iterations and a change flag. Input objects and component data remain untouched.

## Scene geometry

`NodeGeometryPolicy.measure` receives world geometry and returns separate visual, hit, selection, collision and connector bounds. Include external chrome in collision bounds when the product must reserve that space. A pending placeholder may have a smaller visual footprint while its collision footprint reserves a later state.

The generic controller optionally resolves collisions when committing geometry. Pure helpers also support insertion, world/parent coordinate conversion, dragging and rigid group separation. Parent-child containment is intentional overlap: exclude those pairs before separation and convert child results back to parent-relative storage.

Do not calculate product layout in a route or DOM view. A product adapter chooses measurements, permitted movement and insertion policy, then uses the shared geometry.

## Rigid groups and trees

The [tidy-tree layout](../src/shared/tree-layout/layout-tree.ts) places abstract boxes in subtree bands. It is independent of collision separation. A caller may first lay out a tree and then submit one bounding box for the whole tree.

When a rigid box moves, translate every member by the same delta. This preserves internal spacing while allowing other trees or loose nodes to push against the group. The [rigid group helper](../src/shared/canvas-node/rigid-group-collisions.ts) preserves caller payloads and fixed-group constraints.

Whether a node is a generated output, branch marker, container or loose item belongs to the adapter. The engine does not infer these roles from type names.

## Failure diagnosis

| Symptom | Check |
|---|---|
| Children leave their container | Parent-child exclusions and world-to-parent conversion |
| Group members lose spacing | The group was resolved member-by-member instead of as a rigid box |
| Painted controls overlap despite separated nodes | Collision measurements omit chrome or a pending-state reservation |
| Small overlaps remain | Threshold, fixed constraints and iteration limit |
| Drag completion jumps twice | A host reapplied transient overrides after accepting final geometry |

[Rendering and lifecycle](RENDERING-ENGINE.md) explains measurement and gesture ownership. Product-specific grouping and lineage policies belong in the consuming package.

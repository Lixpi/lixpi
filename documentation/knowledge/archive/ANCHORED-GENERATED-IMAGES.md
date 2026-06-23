# Anchored Generated Images

Status: retired from the active workspace canvas implementation.

More info here: https://github.com/Lixpi/lixpi/pull/171

This note preserves the design because it solved a real interaction problem in an interesting way, even though the product moved to connector-backed generated image nodes.

## Original Goal

Generated images should feel attached to the AI response that created them without forcing the user to follow a connector line across the canvas. The image appeared partially over the right side of the AI chat thread, aligned with the response message that produced it. Dragging the thread moved the image with it, while dragging the image far enough away detached it into a normal canvas node.

The design tried to make generated images feel like inline visual artifacts of the conversation while still keeping them as real canvas nodes.

## User-Facing Behavior

The feature behaved like this:

1. A user generated an image from an AI chat thread.
2. During partial generation, a canvas image node was created immediately with the same loading border and spinner used by normal generated images.
3. Instead of placing the image beside the thread with an edge, the image overlapped the right side of the thread.
4. The image was vertically aligned to the response message DOM element when `responseMessageId` was known.
5. The image moved with its parent thread during thread drag.
6. The image stayed independently selectable so its bubble menu could open.
7. Dragging the image away from the thread detached it and made it a normal canvas node.
8. Collision resolution ignored the image/thread pair while the image was anchored because overlap was intentional.

## Implementation Shape

The implementation had four main pieces.

### Runtime Anchor Registry

The canvas kept an in-memory registry keyed by image node id:

```typescript
type AnchoredImageEntry = {
    imageNodeId: string
    threadNodeId: string
    threadReferenceId: string
    responseMessageId: string
    imageHeight: number
}
```

The registry needed these operations:

- `anchorImage(entry)` to attach an image to a thread.
- `removeAnchor(imageNodeId)` to detach or delete the image.
- `getAnchorsForThread(threadNodeId)` to move images with the thread.
- `getAnchor(imageNodeId)` and `isAnchored(imageNodeId)` for selection and resize paths.
- `getExclusionPairsForCollisions()` to allow intentional overlap between the image and thread.
- `clear()` before a full DOM rerender.

The registry was not persisted. Rehydration was attempted from `generatedBy.aiChatThreadId` and missing connector edges, which became one of the reasons this approach aged poorly.

### Placement Math

Anchored placement used the thread DOM to find the response message that created the image:

1. Compute a constrained image width from the thread width.
2. Find `[data-message-id="${responseMessageId}"]` inside the thread DOM.
3. Fall back to the last response message while partial generation had no final message id.
4. Convert message DOM coordinates into canvas coordinates using the thread DOM rect and current zoom.
5. Place the image near the right side of the response message, overlapping the thread body.
6. Preserve the image aspect ratio when computing the final height.

The old constants were conceptually:

```typescript
const OVERLAP_PADDING_X = 16
const OVERLAP_GAP_Y = 8
const OVERLAP_WIDTH_RATIO = 0.68
const OVERLAP_INTERSECTION_RATIO = -0.06
```

The important lesson is that this geometry depended on both persisted canvas node coordinates and live DOM measurements. It therefore needed to be scheduled after DOM insertion and after response-message layout stabilized.

### Workspace Interaction Coupling

The drag plan had to treat anchored images differently from ordinary selected image nodes:

- A thread drag collected its anchored image ids and moved them visually with the thread.
- A context-region drag excluded generated/anchored output images so regions did not pull graph outputs around accidentally.
- A selected set filtered anchored images out when their thread was already selected.
- Marquee selection could resolve an anchored image to the parent thread for group movement, but plain click still had to select the image itself.

That last rule was subtle. If `mousedown` immediately selected the resolved parent thread, the selection overlay could appear above the image before `mouseup`, swallow the click, and prevent the image bubble menu from opening. The fix was deferred selection:

- On first meaningful drag movement, select the resolved drag target.
- On mouseup without movement, select the original node id.

This deferred-selection pattern is still useful for any future canvas feature where click target and drag target differ.

### Styling

Anchored images used a CSS class on the normal image DOM node:

```scss
.workspace-image-node.workspace-image-node-anchored {
    pointer-events: auto;
    border-radius: 6px;
    box-shadow: var(--workspace-image-anchored-box-shadow);
}
```

The class was purely visual and behavioral glue. It did not change the persisted node model.

## Data Model

The feature intentionally avoided adding a persisted `anchored` node property. Generated images were still ordinary `ImageCanvasNode` records with `generatedBy` metadata.

This made migration easy, but it made refresh behavior ambiguous. On page load, the canvas had to infer whether an old generated image should be re-anchored. The previous heuristic was:

- The image has `generatedBy.aiChatThreadId` matching a thread/context-region reference id.
- There is no connector edge from the thread node to the image node.

That heuristic was fragile because missing edge data and intentional detached state looked too similar.

If this feature is ever rebuilt, persist explicit placement state instead:

```typescript
type GeneratedImagePlacement =
    | { mode: 'connector' }
    | {
        mode: 'anchored'
        threadNodeId: string
        responseMessageId: string
        detachedAt?: { x: number; y: number }
    }
```

Store it on the image node or in a dedicated generated-image relation record. Do not infer anchoring from missing edges.

## How To Rebuild It Safely

Use this sequence if the product direction brings the interaction back.

1. Add an explicit persisted placement field and a migration for old generated images.
2. Keep connector placement as the default fallback for missing or invalid anchored metadata.
3. Build a small runtime anchor manager from persisted placement data after every canvas state render.
4. Compute anchored positions only after the thread DOM and response message DOM are mounted.
5. Keep the image as a real image canvas node so selection, resize, deletion, download, and branching reuse existing paths.
6. Add collision exclusion pairs only for currently valid anchored image/thread pairs.
7. During thread drag, move anchored images as live visual companions and commit their final positions with the thread.
8. During image drag, remove the anchored placement once the image center leaves the thread's intended detach bounds.
9. During thread resize, recompute anchored image width from the new thread width and preserve image aspect ratio.
10. Keep plain click selection on the original image node, and defer parent-thread selection until real drag movement starts.
11. Add source-shape tests around click-vs-drag selection, collision exclusions, refresh rehydration, and deletion cleanup.
12. Add interaction tests for partial image creation, final image completion, thread drag, image detach, image resize, and thread resize.

## Failure Modes To Avoid

- Do not infer anchoring from the absence of an edge. Persist placement explicitly.
- Do not make the image a child of the thread DOM. It should stay a canvas node so existing image tools keep working.
- Do not select the parent thread on image `mousedown`. Defer drag target resolution until movement crosses the drag threshold.
- Do not run collision resolution between an anchored image and its thread.
- Do not derive image proportions from hidden DOM image natural dimensions. Use the persisted `ImageCanvasNode.aspectRatio`.
- Do not rehydrate generated images with connector edges as anchored images.
- Do not let anchored output images become context-region child nodes by accident.
- Do not keep runtime anchor state as the source of truth. It should be a projection of persisted placement state.

## Why It Was Retired

Connector-backed generated images won because they are simpler and more explicit:

- The graph relation is visible as an edge.
- Refresh and collaboration state do not need placement inference.
- Drag, resize, collision, and selection code paths are ordinary node paths.
- Generated outputs are easier to reason about as independent artifacts.
- Context-region clouds can exclude generated outputs without also handling a second placement mode.

The anchored approach was still valuable as a prototype. It exposed useful interaction lessons about deferred selection, DOM-measured alignment, collision exclusions, and explicit placement state.

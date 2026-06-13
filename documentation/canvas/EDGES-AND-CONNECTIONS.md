---
title: Edges & Connections
description: The workspace connection system — handles, drag-to-connect, the WorkspaceConnectionManager, PIXI edge rendering, routing rules, proximity connect, message-level anchoring, selection, deletion, and persistence.
---

# Edges & Connections

Visual connections (edges/arrows) between canvas nodes let users show relationships, context flows, and dependencies between workspace entities. A user drags from a handle on one node to another to create a relationship line. Edges are not purely cosmetic: an edge-connected node is force-included in the AI context for a chat turn, and an edge with a `sourceMessageId` records which AI response produced a generated image. That data shape is defined in [Workspace Model](./WORKSPACE-MODEL.md#workspaceedge); this page covers how connections are made, routed, drawn, selected, and persisted.

{% callout type="note" %}
This page is part of the canvas domain. For the `WorkspaceEdge` schema and the surrounding data model see [Workspace Model](./WORKSPACE-MODEL.md). For how edge geometry is painted into the PIXI layer and kept aligned with the DOM see [Rendering Engine](./RENDERING-ENGINE.md). For how `sourceMessageId` feeds AI context resolution see [Context Relevance](../ai-chat/CONTEXT-RELEVANCE.md).
{% /callout %}

## Key Features

- **Connection handles** on each node (visible on hover).
- **Drag-to-connect** interaction using `XYHandle.onPointerDown` from `@xyflow/system`.
- **Edge rendering** through PIXI edge data produced by [`WorkspaceConnectionManager.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceConnectionManager.ts) and drawn by [`pixiEdgeRenderer.ts`](../../services/web-ui/src/infographics/workspace/rendering/pixiEdgeRenderer.ts).
- **Edge selection and deletion** (click to select, Delete/Backspace to remove).
- **Persistence** of edges in `CanvasState`.

## Architecture

`CanvasState` owns the array of edges. `WorkspaceConnectionManager` keeps a node lookup and drives the `XYHandle` API; it produces PIXI edge data that the PIXI edge renderer draws, while handle DOM elements sit on top of node cards as the interaction surface.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart TB
    subgraph "Data Layer"
        CS[CanvasState]
        WE[WorkspaceEdge array]
        CS --> WE
    end

    subgraph "Connection Manager"
        WCM[WorkspaceConnectionManager]
        NL[nodeLookup: Map]
        XYH[XYHandle API]
        WCM --> NL
        WCM --> XYH
    end

    subgraph "Rendering"
        PXD[PIXI edge data]
        PER[pixiEdgeRenderer Graphics]
        HANDLES[Handle DOM Elements]
        PXD --> PER
    end

    subgraph "Canvas"
        WC[WorkspaceCanvas.ts]
        NODES[Node DOM Elements]
        PZ[XYPanZoom]
    end

    WC --> WCM
    WC --> HANDLES
    NODES --> HANDLES
    WCM -->|onConnect| WE
    WE -->|syncEdges| WCM
    WCM -->|setPixiEdges| PXD
    XYH -->|in-progress state| WCM
```

## Connection Flow

A connection is a three-phase drag: pointer-down on a source handle starts an in-progress edge, pointer-move tracks the closest valid handle and updates a temporary edge datum, and a pointer-up over a valid handle commits a permanent edge.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant Handle as Source Handle DOM
    participant XYH as XYHandle.onPointerDown
    participant WCM as WorkspaceConnectionManager
    participant PIXI as PIXI Edge Layer
    participant Target as Target Handle DOM
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: START DRAG
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, Target: PHASE 1 - START DRAG
        User->>Handle: pointerdown
        activate Handle
        Handle->>XYH: Call with params
        activate XYH
        XYH->>WCM: updateConnection(inProgress)
        activate WCM
        WCM->>PIXI: Emit temp edge datum
        deactivate Handle
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: MOVE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, Target: PHASE 2 - MOVE
        loop Mouse Move
            User->>XYH: pointermove
            XYH->>XYH: Find closest valid handle
            XYH->>WCM: updateConnection(newPosition)
            WCM->>PIXI: Update temp edge datum
        end
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: COMPLETE
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, Target: PHASE 3 - COMPLETE
        User->>Target: pointerup over valid handle
        XYH->>XYH: isValidConnection check
        XYH->>WCM: onConnect({ source, target })
        deactivate XYH
        WCM->>WCM: Add edge to state
        WCM->>PIXI: Emit permanent edge datum
        deactivate WCM
    end
```

## WorkspaceConnectionManager

The connection system's brain lives at [`WorkspaceConnectionManager.ts`](../../services/web-ui/src/infographics/workspace/WorkspaceConnectionManager.ts). It owns the node lookup, the in-progress connection state, the edge list, the selected-edge state, and the cached PIXI edge data and flattened paths used for hit testing.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
classDiagram
    class WorkspaceConnectionManager {
        -nodeLookup: Map~string, InternalNodeBase~
        -edges: WorkspaceEdge[]
        -selectedEdgeId: string | null
        -connectionInProgress: ConnectionState | null
        -cachedPixiEdgeData: PixiEdgeRenderDatum[]
        -cachedFlattenedEdgePaths: Map

        +syncNodes(canvasNodes: CanvasNode[])
        +syncEdges(edges: WorkspaceEdge[])
        +onHandlePointerDown(event, handleMeta)
        +recomputePixiEdgesOnly(zoom: number)
        +getEdgeMidpointRect(edgeId: string)
        +selectEdge(edgeId: string)
        +deleteSelectedEdge()
        +render()
        +destroy()
    }

    class HandleMeta {
        nodeId: string
        handleId: string
        isTarget: boolean
        handleDomNode: Element
    }

    class ConnectionState {
        fromNode: string
        fromHandle: string
        toPosition: XYPosition
        isValid: boolean
    }
```

### Responsibilities

- Maintains `nodeLookup` (a Map of node ID → internal node representation with handle bounds).
- Tracks in-progress connection state for rendering the temporary line.
- Validates connections (no duplicates, no self-loops).
- Delegates to `XYHandle.onPointerDown` for the actual drag interaction.
- Builds PIXI edge render data from shared connector path math.
- Uses cached flattened PIXI path data for edge hit testing and bubble-menu anchoring.
- Manages edge selection state.

## Handle DOM Elements

Each workspace node has connection handles at the left (target) and right (source) edges:

```text
┌─────────────────────────────────────────┐
│ ○                                     ○ │
│ left                               right│
│ (target)                         (source)│
│                                         │
│         Node Content                    │
│                                         │
└─────────────────────────────────────────┘
```

Handles are:

- Hidden by default, shown on node hover (CSS).
- Marked with `data-nodeid`, `data-handleid`, and `data-handlepos` attributes (required by `XYHandle`).
- Wired with a `pointerdown` listener that calls `WorkspaceConnectionManager.onHandlePointerDown`.

## Edge Rendering

Edges are rendered as PIXI `Graphics` by [`pixiEdgeRenderer.ts`](../../services/web-ui/src/infographics/workspace/rendering/pixiEdgeRenderer.ts). `WorkspaceConnectionManager` builds edge render data with shared path helpers from [`paths.ts`](../../services/web-ui/src/infographics/connectors/paths.ts), then sends it to the PIXI media layer for drawing, hit testing, and bubble-menu anchoring. For the full DOM/PIXI ownership split and the viewport bridge that keeps the two layers aligned, see [Rendering Engine](./RENDERING-ENGINE.md).

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'secondaryTextColor': '#1a3a47', 'secondaryBorderColor': '#4a8a9d', 'tertiaryColor': '#DCECE9', 'tertiaryTextColor': '#1a3a47', 'tertiaryBorderColor': '#82B2C0', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
flowchart LR
    subgraph "Z-Order (bottom to top)"
        BG[Canvas Background]
        EDGES[PIXI Edge Layer]
        NODES[Node Cards]
        HANDLES[Handle Overlays]
    end

    BG --> EDGES --> NODES --> HANDLES
```

Edge styling:

- **Path type**: `horizontal-bezier`.
- **Stroke width**: `2px` from the zoom-compensation floor upward.
- **Marker (arrowhead) size**: `16px` from the zoom-compensation floor upward.
- **Color**: CSS connector custom properties from the workspace pane, using the focus color when selected.
- **Dashes**: temporary (in-progress) and proximity edges render dashed.

## Routing

`WorkspaceConnectionManager` handles edge state and path planning, while `pixiEdgeRenderer.ts` draws committed edges as PIXI graphics. The routing style is configured in `settings.connector.lineCurve`; the current default is `horizontal-bezier`.

| Behavior | Rule |
|----------|------|
| **Auto-alignment** | If a source node is vertically aligned with its target, the connection snaps to a perfectly straight horizontal line by adjusting `targetT`. |
| **Corner snapping** | If nodes are not aligned, the connector snaps to the nearest top/bottom corner (`t = 0.05` or `t = 0.95`) to minimize diagonal visual clutter. |
| **Drag visualization** | While dragging, connections use a smooth bezier curve to distinguish them from committed orthogonal edges. |
| **Message-level anchoring** | See [Message-Level Anchoring](#message-level-anchoring) below. |

## Message-Level Anchoring

When an edge has a `sourceMessageId` — connecting a specific AI response to a generated image — the renderer dynamically calculates `sourceT` to anchor the arrow exactly to that message bubble in the DOM. It also intelligently adjusts `targetT` so the arrow points in a straight line to the target image height, preventing the "diving arrow" effect where a connector would otherwise plunge diagonally toward the image's vertical center.

The `sourceMessageId` is the same property defined on `WorkspaceEdge` (see [Workspace Model](./WORKSPACE-MODEL.md#workspaceedge)); it ties a generated image back to the exact `aiResponseMessage` that produced it, and that linkage is what lets context extraction associate images with their originating conversation turns ([Context Relevance](../ai-chat/CONTEXT-RELEVANCE.md)).

## Proximity Connect

Dragging a node (Document or Image) near an AI Chat Thread automatically suggests a connection with a dashed "ghost" line. Dropping the node creates the link. The proximity threshold is **1200px**, and the system prevents duplicate connections. This makes it easy to pull source material into a thread's context without precisely targeting a handle.

## Edge Selection and Deletion

An edge starts unselected; clicking it selects it (and shows a bubble menu below the edge with a Delete action). Clicking elsewhere or pressing Escape deselects it; Delete or Backspace removes the selected edge.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#F6C7B3', 'primaryTextColor': '#5a3a2a', 'primaryBorderColor': '#d4956a', 'secondaryColor': '#C3DEDD', 'lineColor': '#d4956a', 'textColor': '#5a3a2a'}}}%%
stateDiagram-v2
    [*] --> Unselected
    Unselected --> Selected: Click on edge
    Selected --> Unselected: Click elsewhere
    Selected --> Unselected: Escape key
    Selected --> [*]: Delete/Backspace key
```

When an edge is selected, it is visually highlighted and a bubble menu appears below the edge with a Delete action. Hit testing for selection uses the cached flattened PIXI path data maintained by the connection manager.

## Edge Persistence

Edge changes follow the same pattern as node changes — committed locally first, pushed into the stores, then persisted over NATS via `WORKSPACE.UPDATE_CANVAS_STATE`. Unlike debounced pan/zoom, edge create/delete/reconnect persists immediately.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'noteBkgColor': '#82B2C0', 'noteTextColor': '#1a3a47', 'noteBorderColor': '#5a9aad', 'actorBkg': '#F6C7B3', 'actorBorder': '#d4956a', 'actorTextColor': '#5a3a2a', 'actorLineColor': '#d4956a', 'signalColor': '#d4956a', 'signalTextColor': '#5a3a2a', 'labelBoxBkgColor': '#F6C7B3', 'labelBoxBorderColor': '#d4956a', 'labelTextColor': '#5a3a2a', 'loopTextColor': '#5a3a2a', 'activationBorderColor': '#9DC49D', 'activationBkgColor': '#9DC49D', 'sequenceNumberColor': '#5a3a2a'}}}%%
sequenceDiagram
    participant User
    participant WCM as WorkspaceConnectionManager
    participant WC as WorkspaceCanvas
    participant Svelte as WorkspaceCanvas.svelte
    participant Store as workspaceStore
    participant WSvc as WorkspaceService
    participant NATS
    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 1: ADD EDGE LOCALLY
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(220, 236, 233)
        Note over User, NATS: PHASE 1 - ADD EDGE LOCALLY
        User->>WCM: Complete connection (onConnect)
        activate WCM
        WCM->>WC: Add edge to local state
        deactivate WCM
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 2: UPDATE STORES
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(195, 222, 221)
        Note over User, NATS: PHASE 2 - UPDATE STORES
        activate WC
        WC->>Svelte: onCanvasStateChange({ nodes, edges })
        activate Svelte
        Svelte->>Store: updateCanvasState()
        Svelte->>WSvc: updateCanvasState()
        deactivate Svelte
        deactivate WC
    end

    %% ═══════════════════════════════════════════════════════════════
    %% PHASE 3: PERSIST
    %% ═══════════════════════════════════════════════════════════════
    rect rgb(246, 199, 179)
        Note over User, NATS: PHASE 3 - PERSIST
        activate WSvc
        WSvc->>NATS: WORKSPACE.UPDATE_CANVAS_STATE
        deactivate WSvc
    end
```

## Related Pages

- [Workspace Model](./WORKSPACE-MODEL.md) — the `WorkspaceEdge` schema, `CanvasState`, and persistence cadence.
- [Rendering Engine](./RENDERING-ENGINE.md) — the PIXI edge layer, z-order, and DOM/PIXI alignment.
- [Context Relevance](../ai-chat/CONTEXT-RELEVANCE.md) — how edge-connected nodes and `sourceMessageId` feed AI context.
- [Branch Lineage & Provenance](../media-generation/BRANCH-LINEAGE.md) — how generated-image edges are created with `sourceMessageId` during a branch.

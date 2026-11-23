import {
    type CapabilityAgentRegistration,
} from '../../../backend/capability-agent-registry.ts'
import {
    type CanvasCollaborationPresence,
} from '@lixpi/constants'
import { CanvasAgentOperations } from './canvas-agent-operations.ts'
import {
    type CanvasAgentAccess,
    type CanvasAgentDocumentEdit,
    type CanvasAgentDocumentRole,
    type CanvasCameraEdit,
    type CanvasConnectionEdit,
    type CanvasNodePatch,
    type CanvasPlacement,
} from './canvas-agent-ports.ts'

type Schema = Record<string, unknown>

const object = (
    properties: Record<string, Schema>,
    required: string[] = [],
): Schema => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
})

const union = (branches: Schema[]): Schema => {
    const properties: Record<string, Schema> = {}

    for (const branch of branches)
        for (const [name, schema] of Object.entries(branch.properties as Record<string, Schema>))
            properties[name] = Object.hasOwn(schema, 'const') ? { type: 'string' } : schema

    return {
        ...object(properties),
        oneOf: branches,
    }
}

const identifier = {
    type: 'string',
    pattern: '^[A-Za-z0-9_.:-]{1,192}$',
}
const coordinate = {
    type: 'number',
    minimum: -1e9,
    maximum: 1e9,
}
const point = object(
    {
        x: coordinate,
        y: coordinate,
    },
    ['x', 'y'],
)
const positiveNumber = {
    type: 'number',
    exclusiveMinimum: 0,
    maximum: 1e9,
}
const zoom = {
    type: 'number',
    minimum: 0.05,
    maximum: 16,
}
const version = {
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
}
const ids = {
    type: 'array',
    items: identifier,
    maxItems: 32,
    uniqueItems: true,
}
const dimensions = object(
    {
        width: positiveNumber,
        height: positiveNumber,
    },
    ['width', 'height'],
)
const node = object({ nodeId: identifier }, ['nodeId'])
const title = {
    type: 'string',
    minLength: 1,
    maxLength: 512,
}
const text = {
    type: 'string',
    maxLength: 64000,
}
const role = {
    type: 'string',
    enum: ['content', 'capabilityArtifact'],
}
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] })
const fraction = {
    type: 'number',
    minimum: 0,
    maximum: 1,
}
const connection = {
    sourceNodeId: identifier,
    targetNodeId: identifier,
    sourceHandle: identifier,
    targetHandle: identifier,
    sourceT: fraction,
    targetT: fraction,
    pathType: {
        type: 'string',
        enum: ['bezier', 'straight', 'smoothstep', 'horizontal-bezier', 'orthogonal'],
    },
}
const placement = {
    position: point,
    dimensions,
    parentId: identifier,
    avoidOverlap: { type: 'boolean' },
}

type ToolDefinition = {
    description: string
    schema: Schema
    intent: 'inspect' | 'execute'
    run: (
        operations: CanvasAgentOperations,
        input: Readonly<Record<string, unknown>>,
    ) => Promise<object>
}

export const WORKSPACE_CANVAS_OPERATION = 'canvas-interaction'

const failureGuidance: Record<string, string> = {
    CANVAS_LEASE_LOST: 'A participant took control of the target. Inspect the canvas for current ownership before proposing another edit.',
    CANVAS_LEASE_PREEMPTED: 'A person took control of the target. Inspect the canvas for current ownership before proposing another edit.',
    CANVAS_NODE_NOT_FOUND: 'The node is absent. Inspect the canvas and use a current node ID.',
    CANVAS_EDGE_NOT_FOUND: 'The connection is absent. Inspect the canvas and use a current edge ID.',
    CANVAS_NODE_PARENT_CYCLE: 'The requested parent would create a cycle. Choose a node outside this grouping.',
    CANVAS_NODE_PATCH_DUPLICATE: 'Send one geometry patch per node.',
    CANVAS_EDGE_SELF_CONNECTION: 'Connect two distinct nodes.',
    CANVAS_MEDIA_SOURCE_REQUIRED: 'Use the public media link supplied in the current turn, or place an uploaded Asset by ID.',
    CANVAS_ASSET_HAS_NO_PLACEABLE_CONTENT: 'This Asset does not have a placeable canvas node type.',
    CANVAS_NODE_HAS_NO_ASSET: 'This node has no editable Asset.',
    CANVAS_NODE_ASSET_CHANGED: 'The node points to a different Asset. Inspect the canvas before editing.',
    CANVAS_REMOVAL_NEIGHBORS_CHANGED: 'The node gained a child or connection while waiting. Inspect the canvas before removing it.',
    CANVAS_REVISION_CONFLICT: 'The graph changed. Inspect the latest canvas and reapply the requested edit to that state.',
    STALE_CANVAS_STATE: 'The graph changed. Inspect the latest canvas and reapply the requested edit to that state.',
    REVISION_CONFLICT: 'The Asset changed. Inspect its current revision before renaming it.',
    CANVAS_DOCUMENT_VERSION_CONFLICT: 'The document changed. Read the current document and recalculate the operation.',
    CANVAS_DOCUMENT_STEP_INVALID: 'The step is incompatible with the current document structure or range. Read the document and correct the step.',
    CANVAS_DOCUMENT_INVALID_EMBEDDED_ASSET: 'An embedded Asset is absent or unavailable to this workspace.',
    CANVAS_DOCUMENT_INVALID_LINK: 'Use a valid web, email, telephone or relative link.',
    CANVAS_DOCUMENT_ARTIFACT_CHANGE_INVALID: 'The step changes fields protected by this Artifact type.',
    NOT_FOUND: 'The Asset or placement is unavailable in this workspace.',
    WORKSPACE_ACCESS_DENIED: 'Current permissions do not allow this workspace action.',
    CANVAS_TARGET_OWNED: 'Another human holds this canvas target.',
    GENERATED_OUTPUT_NOT_FOUND: 'The generated output or lineage changed. Inspect the canvas before continuing.',
    STALE_MEDIA_REQUEST_REVISION: 'The generation request changed. Inspect current status before cancelling it.',
    CANVAS_ASSET_WRITE_BUSY: 'A write is already in flight for this Asset. Read the current document before editing again.',
    DOCUMENT_ROLE_NOT_FOUND: 'This Asset does not contain the requested document role.',
    LEASE_HELD: 'A different workspace currently holds the Asset editing lease.',
    LEASE_INVALID: 'The Asset editing lease has expired or changed.',
    PERMISSION_DENIED: 'The current workspace permissions do not allow this action.',
    ASSET_NOT_ATTACHABLE: 'The Asset is not available for placement.',
    ASSET_ATTACH_CONFLICT: 'The Asset or its placement changed. Inspect the canvas before retrying.',
    SCOPE_DENIES_WORKSPACE: 'The Asset is outside the current workspace scope.',
    TITLE_REQUIRED: 'Use a nonempty title.',
}

const toolDefinitions: Record<string, ToolDefinition> = {
    inspect_canvas: {
        description: 'Read the active workspace canvas. Returns current node IDs, layout, Asset titles and revisions, connections, viewers, actors, selections, active target ownership and the waiting queue. Use viewers to count people and actors for device sessions, agents, and ownership. Use before acting on an existing canvas object.',
        schema: object({}),
        intent: 'inspect',
        run: async operations => await operations.inspect(),
    },
    navigate_canvas: {
        description: 'Pan, zoom or center your canvas camera. Use a world-space center, relative pan offset or a focus node ID. People following you see the camera move.',
        schema: object({
            center: point,
            offset: point,
            zoom,
            focusNodeId: identifier,
        }),
        intent: 'execute',
        run: async (operations, input) => await operations.navigate(input as CanvasCameraEdit),
    },
    set_canvas_presence: {
        description: 'Show followers your cursor, node or edge selection, menu or submenu, editor selection, side panel, draft connection or media playback. Positions on the canvas use world coordinates. Omit fields to preserve them.',
        schema: object({
            cursor: nullable(point),
            panel: object(
                {
                    isOpen: { type: 'boolean' },
                    mode: {
                        type: 'string',
                        enum: ['capabilities', 'artifacts', 'media', 'aiThreads'],
                    },
                    contextNodeIds: ids,
                    detailsTarget: nullable(
                        object(
                            {
                                kind: {
                                    type: 'string',
                                    enum: ['output', 'branch-marker'],
                                },
                                nodeId: identifier,
                            },
                            ['kind', 'nodeId'],
                        ),
                    ),
                    width: {
                        type: 'number',
                        minimum: 0,
                        maximum: 4096,
                    },
                },
                ['isOpen', 'mode'],
            ),
            connector: nullable(
                object(
                    {
                        source: point,
                        target: point,
                        pathType: connection.pathType,
                        lineStyle: {
                            type: 'string',
                            enum: ['solid', 'dashed'],
                        },
                    },
                    ['source', 'target', 'pathType', 'lineStyle'],
                ),
            ),
            library: nullable(
                object(
                    {
                        kind: {
                            type: 'string',
                            enum: ['media', 'artifacts', 'capabilities'],
                        },
                        selectedId: nullable(identifier),
                        scrollTop: {
                            type: 'number',
                            minimum: 0,
                            maximum: 1e9,
                        },
                    },
                    ['kind', 'selectedId'],
                ),
            ),
            composer: nullable(
                object(
                    {
                        conversationAssetId: nullable(identifier),
                        content: {
                            type: 'object',
                            description: 'The unsent ProseMirror composer document shown to authorized followers.',
                        },
                    },
                    ['content'],
                ),
            ),
            composerSelection: nullable(
                object(
                    {
                        anchor: version,
                        head: version,
                    },
                    ['anchor', 'head'],
                ),
            ),
            playback: nullable(
                object(
                    {
                        nodeId: identifier,
                        time: {
                            type: 'number',
                            minimum: 0,
                        },
                        paused: { type: 'boolean' },
                        rate: {
                            type: 'number',
                            minimum: 0.25,
                            maximum: 4,
                        },
                        volume: fraction,
                        muted: { type: 'boolean' },
                        fullscreen: { type: 'boolean' },
                    },
                    ['nodeId', 'time', 'paused', 'rate', 'volume', 'muted'],
                ),
            ),
            selection: object(
                {
                    nodeIds: ids,
                    edgeIds: ids,
                },
                ['nodeIds', 'edgeIds'],
            ),
            menu: nullable(
                object(
                    {
                        kind: identifier,
                        controlId: identifier,
                        textSelection: object(
                            {
                                anchor: version,
                                head: version,
                            },
                            ['anchor', 'head'],
                        ),
                        nodeId: identifier,
                        edgeId: identifier,
                        position: point,
                    },
                    ['kind'],
                ),
            ),
            caret: nullable(
                object(
                    {
                        nodeId: identifier,
                        field: {
                            type: 'string',
                            enum: ['content', 'title'],
                        },
                        anchor: version,
                        head: version,
                    },
                    ['nodeId', 'anchor', 'head'],
                ),
            ),
        }),
        intent: 'execute',
        run: async (operations, input) => await operations.presence(input as CanvasCollaborationPresence),
    },
    follow_canvas_actor: {
        description: 'Follow the canvas camera of a participant in this workspace. Use a viewer ID for a person or an actor ID for an agent from inspect_canvas. A person is followed on their most recently active device. Pass null to return to your independent camera.',
        schema: object({ actorId: nullable(identifier) }, ['actorId']),
        intent: 'execute',
        run: async (operations, input) => await operations.follow(input.actorId as string | null),
    },
    edit_canvas_geometry: {
        description: 'Move, resize or reparent one or more nodes together. Position is relative to the parent if present and takes precedence over offset. Omit position to preserve world position when changing parent. Set parentId to null to unparent. An agent waits for occupied targets in queue order.',
        schema: object(
            {
                nodes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 24,
                    items: object(
                        {
                            nodeId: identifier,
                            position: point,
                            offset: point,
                            dimensions,
                            parentId: nullable(identifier),
                        },
                        ['nodeId'],
                    ),
                },
            },
            ['nodes'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.editGeometry(input.nodes as CanvasNodePatch[]),
    },
    edit_canvas_connection: {
        description: 'Create, update or remove a canvas connection. Connect takes the two endpoint node IDs. Update and disconnect take the existing edge ID. Handles, attachment fractions and path types control routing.',
        schema: union([
            object(
                {
                    action: { const: 'connect' },
                    ...connection,
                },
                ['action', 'sourceNodeId', 'targetNodeId'],
            ),
            object(
                {
                    action: { const: 'update' },
                    edgeId: identifier,
                    ...connection,
                },
                ['action', 'edgeId'],
            ),
            object(
                {
                    action: { const: 'disconnect' },
                    edgeId: identifier,
                },
                ['action', 'edgeId'],
            ),
        ]),
        intent: 'execute',
        run: async (operations, input) => await operations.editConnection(input as CanvasConnectionEdit),
    },
    create_canvas_node: {
        description: 'Create a workspace document and place it on the canvas, place an available Asset, or duplicate the placement of an existing Asset. Supply a location in world coordinates or relative to the specified parent. Omit the location to place at your camera center with overlap resolution. The duplicate shares its Asset content and title.',
        schema: union([
            object(
                {
                    ...placement,
                    kind: { const: 'document' },
                    title,
                    content: text,
                },
                ['kind', 'title'],
            ),
            object(
                {
                    ...placement,
                    kind: { const: 'asset' },
                    assetId: identifier,
                },
                ['kind', 'assetId'],
            ),
            object(
                {
                    ...placement,
                    kind: { const: 'duplicate' },
                    sourceNodeId: identifier,
                },
                ['kind', 'sourceNodeId'],
            ),
        ]),
        intent: 'execute',
        run: async (operations, input) => await operations.place(
            input as CanvasPlacement,
            input.kind === 'document'
                ? {
                    title: input.title as string,
                    content: input.content as string | undefined,
                }
                : input.kind === 'asset'
                    ? { assetId: input.assetId as string }
                    : { sourceNodeId: input.sourceNodeId as string },
        ),
    },
    delete_canvas_node: {
        description: 'Remove a canvas placement and its incident connections. Direct children stay on the canvas at their world positions. The standard Asset reference lifecycle applies.',
        schema: node,
        intent: 'execute',
        run: async (operations, input) => await operations.remove(input.nodeId as string),
    },
    rename_canvas_asset: {
        description: 'Rename the Asset behind a canvas node, including its other placements. Use its current Asset revision from inspect_canvas.',
        schema: object(
            {
                nodeId: identifier,
                title,
                expectedRevision: version,
            },
            ['nodeId', 'title', 'expectedRevision'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.rename(
            input.nodeId as string,
            input.title as string,
            input.expectedRevision as number,
        ),
    },
    import_canvas_media: {
        description: 'Import a public media URL supplied in this conversation turn and place it on the shared canvas. To place a file already uploaded to the workspace, use its Asset ID with the placement tool.',
        schema: object(
            {
                url: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 8192,
                },
                ...placement,
            },
            ['url'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.importMedia(input.url as string, input as CanvasPlacement),
    },
    read_canvas_document: {
        description: 'Read the current editable ProseMirror JSON and version of the Asset behind a chosen canvas node. The result includes concurrent document steps. Use content for ordinary documents and capabilityArtifact for an editable Artifact.',
        schema: object(
            {
                nodeId: identifier,
                role,
            },
            ['nodeId', 'role'],
        ),
        intent: 'inspect',
        run: async (operations, input) => await operations.readDocument(input.nodeId as string, input.role as CanvasAgentDocumentRole),
    },
    edit_canvas_document: {
        description: 'Edit the shared document behind a canvas node at its current version. Provide one ProseMirror step for rich editing, a text replacement with absolute ProseMirror from/to positions, or a serialized JSON array of top-level nodes for a deliberate full replacement. Supply raw steps as serialized JSON. Call read_canvas_document before editing.',
        schema: object(
            {
                nodeId: identifier,
                role,
                expectedVersion: version,
                edit: union([
                    object(
                        { stepJson: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 128000,
                        } },
                        ['stepJson'],
                    ),
                    object(
                        {
                            text,
                            from: version,
                            to: version,
                        },
                        ['text', 'from', 'to'],
                    ),
                    object(
                        { contentJson: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 128000,
                        } },
                        ['contentJson'],
                    ),
                ]),
            },
            ['nodeId', 'role', 'expectedVersion', 'edit'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.editDocument(
            input.nodeId as string,
            input.role as CanvasAgentDocumentRole,
            input.expectedVersion as number,
            input.edit as CanvasAgentDocumentEdit,
        ),
    },
}

export const createCanvasAgentTools = (access: CanvasAgentAccess): CapabilityAgentRegistration[] =>
    Object.entries(toolDefinitions).map(
        ([name, tool]) => ({
            kind: 'tool',
            name,
            description: tool.description,
            schema: tool.schema,
            intent: tool.intent,
            operationFamilies: tool.intent === 'execute' ? [WORKSPACE_CANVAS_OPERATION] : [],
            execute: async (input, context) => {
                const session = await access(context)

                try {
                    const operations = new CanvasAgentOperations(session)

                    return {
                        status: 'completed',
                        data: await tool.run(operations, input),
                    }
                } catch (error) {
                    session.signal.throwIfAborted()
                    const code = error instanceof Error ? error.message : ''
                    const message = Object.hasOwn(failureGuidance, code) ? failureGuidance[code] : undefined

                    if (!message)
                        throw error

                    return {
                        status: 'error',
                        error: {
                            code,
                            message,
                            recoverable: true,
                        },
                    }
                }
            },
        }),
    )

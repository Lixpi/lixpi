import {
    DEPICTION_MEDIA,
    type AssetScope,
    type DepictionMedium,
} from '@lixpi/constants'
import {
    type CapabilityAgentRegistration,
} from '../../../backend/capability-agent-registry.ts'
import { CanvasExtendedOperations } from './canvas-extended-agent-operations.ts'
import { WORKSPACE_CANVAS_OPERATION } from './canvas-agent-tools.ts'
import {
    type CanvasAgentAccess,
} from './canvas-agent-ports.ts'
import {
    type CanvasAssetTarget,
    type CanvasExtendedAccess,
    type CanvasGeneratedOutputReview,
} from './canvas-extended-agent-ports.ts'

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
            properties[name] = Object.hasOwn(schema, 'const') ? { type: typeof schema.const } : schema

    return {
        ...object(properties),
        oneOf: branches,
    }
}

const identifier = {
    type: 'string',
    pattern: '^[A-Za-z0-9_.:-]{1,192}$',
}
const version = {
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
}
const title = {
    type: 'string',
    minLength: 1,
    maxLength: 512,
}
const assetTarget = union([
    object({ nodeId: identifier }, ['nodeId']),
    object({ assetId: identifier }, ['assetId']),
])
const reviewScope = {
    type: 'string',
    enum: [
        'output-node',
        'branch-lineage',
    ],
}

type ToolDefinition = {
    description: string
    schema: Schema
    intent: 'inspect' | 'execute'
    run: (
        operations: CanvasExtendedOperations,
        input: Readonly<Record<string, unknown>>,
    ) => Promise<object>
}

const failureGuidance: Record<string, string> = {
    CANVAS_LEASE_LOST: 'A participant took control of the target. Inspect the canvas for current ownership before proposing another edit.',
    CANVAS_LEASE_PREEMPTED: 'A person took control of the target. Inspect the canvas for current ownership before proposing another edit.',
    CANVAS_TARGET_OWNED: 'Another human holds this canvas target.',
    CANVAS_NODE_NOT_FOUND: 'The node is absent. Inspect the canvas and use a current node ID.',
    CANVAS_NODE_HAS_NO_ASSET: 'This node has no Asset.',
    CANVAS_NODE_ASSET_CHANGED: 'The node points to a different Asset. Inspect the canvas before retrying.',
    CANVAS_REMOVAL_NEIGHBORS_CHANGED: 'The node gained a child or connection while waiting. Inspect the canvas before retrying.',
    CANVAS_REVIEW_TARGETS_CHANGED: 'The generated outputs in this review changed while waiting. Inspect the canvas before retrying.',
    CANVAS_GENERATION_TARGETS_CHANGED: 'The canvas placements of this generation changed while waiting. Inspect the generation before retrying.',
    CANVAS_REVISION_CONFLICT: 'The graph changed. Inspect the latest canvas and reapply the requested change to that state.',
    STALE_CANVAS_STATE: 'The graph changed. Inspect the latest canvas and reapply the requested change to that state.',
    CANVAS_MEDIA_KIND_MISMATCH: 'The replacement must be a media Asset of the same kind as the node.',
    CANVAS_MEDIA_NOT_READY: 'The replacement media has no ready original rendition yet.',
    CANVAS_ASSET_METADATA_EMPTY: 'Supply a title, a depiction medium or both.',
    REVISION_CONFLICT: 'The Asset changed. Inspect its current revision before retrying.',
    TITLE_REQUIRED: 'Use a nonempty title.',
    INVALID_DEPICTION_MEDIUM: 'Use one of the listed depiction media.',
    INVALID_SCOPE: 'Use workspace, user or organization scope.',
    INVALID_SCOPE_OWNER: 'The requested scope is unavailable from this workspace.',
    SCOPE_WOULD_BREAK_REFERENCE: 'Another workspace references this Asset, so the requested scope would remove its access.',
    ASSET_NOT_CATALOGED: 'This Asset has no library entry whose scope can change.',
    NOT_FOUND: 'The Asset, generation or placement is unavailable in this workspace.',
    WORKSPACE_ACCESS_DENIED: 'Current permissions do not allow this workspace action.',
    WORKSPACE_DELETING: 'The workspace is being deleted.',
    PERMISSION_DENIED: 'The current permissions do not allow this action.',
    ASSET_NOT_ATTACHABLE: 'The Asset is not available for placement.',
    ASSET_ATTACH_CONFLICT: 'The Asset or its placement changed. Inspect the canvas before retrying.',
    SCOPE_DENIES_WORKSPACE: 'The Asset is outside the current workspace scope.',
    GENERATED_OUTPUT_NOT_FOUND: 'The node is not a generated output or a branch marker with reviewable outputs.',
    GENERATED_OUTPUT_NOT_READY: 'The generated output is still being produced.',
    GENERATED_OUTPUT_PROVENANCE_NOT_READY: 'The generated output provenance is not sealed yet.',
    ACCEPTED_OUTPUT_IMMUTABLE: 'An accepted output cannot be superseded or rejected.',
    NOT_GENERATED_OUTPUT: 'The Asset is not a generated output.',
    MEDIA_NODE_PROMPT_REGENERATION_NOT_SUPPORTED: 'Superseding a single output keeps its lineage. Set preserveLineage to true.',
    STALE_MEDIA_REQUEST_REVISION: 'The generation changed. Inspect it for its current revision before retrying.',
}

const toolDefinitions: Record<string, ToolDefinition> = {
    inspect_canvas_asset: {
        description: 'Read the library details of an Asset placed on the canvas or already admitted to this conversation: title, revision, scope, placements, media readiness, depiction medium, content descriptor, subject identity status and generated-output review state.',
        schema: object({ target: assetTarget }, ['target']),
        intent: 'inspect',
        run: async (operations, input) => await operations.inspectAsset(input.target as CanvasAssetTarget),
    },
    replace_canvas_media: {
        description: 'Replace the media behind an image, video, audio or media document node with another ready media Asset of the same kind. The node keeps its ID, position, size, parent and connections. The replacement must already be placed on the canvas or admitted to this conversation.',
        schema: object(
            {
                nodeId: identifier,
                assetId: identifier,
            },
            ['nodeId', 'assetId'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.replaceMedia(input.nodeId as string, input.assetId as string),
    },
    update_canvas_asset_metadata: {
        description: 'Change the library title or depiction medium of an Asset placed on the canvas or admitted to this conversation. Use its current revision from inspect_canvas_asset.',
        schema: object(
            {
                target: assetTarget,
                expectedRevision: version,
                title,
                depictionMedium: {
                    type: 'string',
                    enum: [...DEPICTION_MEDIA],
                },
            },
            ['target', 'expectedRevision'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.updateMetadata(
            input.target as CanvasAssetTarget,
            {
                ...(input.title === undefined ? {} : { title: input.title as string }),
                ...(input.depictionMedium === undefined ? {} : { depictionMedium: input.depictionMedium as DepictionMedium }),
            },
            input.expectedRevision as number,
        ),
    },
    remove_canvas_asset_library_entry: {
        description: 'Remove an Asset you own from its library. Its existing canvas placements retain their references. Removing its last reference schedules the Asset for deletion.',
        schema: object(
            {
                target: assetTarget,
                expectedRevision: version,
            },
            ['target', 'expectedRevision'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.removeLibraryEntry(input.target as CanvasAssetTarget, input.expectedRevision as number),
    },
    change_canvas_asset_scope: {
        description: 'Move an Asset you own between the current workspace library, your personal library and the current organization library. Use its current revision from inspect_canvas_asset.',
        schema: object(
            {
                target: assetTarget,
                scope: {
                    type: 'string',
                    enum: [
                        'workspace',
                        'user',
                        'organization',
                    ],
                },
                expectedRevision: version,
            },
            ['target', 'scope', 'expectedRevision'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.changeScope(
            input.target as CanvasAssetTarget,
            input.scope as AssetScope,
            input.expectedRevision as number,
        ),
    },
    review_canvas_generated_output: {
        description: 'Accept, reject or supersede generated outputs on the canvas. The output-node scope reviews one generated output node. The branch-lineage scope reviews every output under a branch marker node. Accepting keeps the outputs as reviewed results. Rejecting removes them and stops unfinished generation. Superseding marks them for regeneration, and preserveLineage keeps the branch marker.',
        schema: union([
            object(
                {
                    nodeId: identifier,
                    scope: reviewScope,
                    action: {
                        type: 'string',
                        enum: [
                            'accept',
                            'reject',
                        ],
                    },
                },
                ['nodeId', 'scope', 'action'],
            ),
            object(
                {
                    nodeId: identifier,
                    scope: { const: 'output-node' },
                    action: { const: 'supersede' },
                    preserveLineage: { const: true },
                },
                ['nodeId', 'scope', 'action', 'preserveLineage'],
            ),
            object(
                {
                    nodeId: identifier,
                    scope: { const: 'branch-lineage' },
                    action: { const: 'supersede' },
                    preserveLineage: { type: 'boolean' },
                },
                ['nodeId', 'scope', 'action', 'preserveLineage'],
            ),
        ]),
        intent: 'execute',
        run: async (operations, input) => await operations.review(input as CanvasGeneratedOutputReview),
    },
    inspect_canvas_generation: {
        description: 'Read the status, revision, runs, canvas node IDs and unresolved prompt references of a media generation in this workspace. Use a generation request ID from inspect_canvas or inspect_canvas_asset.',
        schema: object({ generationRequestId: identifier }, ['generationRequestId']),
        intent: 'inspect',
        run: async (operations, input) => await operations.inspectGeneration(input.generationRequestId as string),
    },
    cancel_canvas_generation: {
        description: 'Stop an unfinished media generation in this workspace and clear its pending canvas placements. Use its current revision from inspect_canvas_generation.',
        schema: object(
            {
                generationRequestId: identifier,
                expectedRevision: version,
            },
            ['generationRequestId', 'expectedRevision'],
        ),
        intent: 'execute',
        run: async (operations, input) => await operations.cancelGeneration(input.generationRequestId as string, input.expectedRevision as number),
    },
}

export const createExtendedCanvasAgentTools = (
    access: CanvasAgentAccess,
    extended: CanvasExtendedAccess,
): CapabilityAgentRegistration[] =>
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
                const extendedSession = await extended(context)

                try {
                    const operations = new CanvasExtendedOperations(session, extendedSession)

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

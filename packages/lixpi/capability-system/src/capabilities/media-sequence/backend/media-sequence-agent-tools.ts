import {
    type CapabilityActionAuthorizationContext,
} from '../../../backend/capability-action-registry.ts'
import {
    type CapabilityAgentTool,
} from '../../../backend/capability-module.ts'
import {
    sequenceIdSchema,
    sequencePatchRequestSchema,
    sequenceExportSchema,
    sequenceCreationDescription,
} from '../shared/sequence-json-schema.ts'

const sourceErrors: Record<string, string> = {
    MEDIA_SEQUENCE_SOURCE_UNAVAILABLE: 'The selected source rendition is unavailable. Check the Asset selection and use original by omitting renditionId unless another existing rendition was explicitly selected. Do not invent source metadata.',
    MEDIA_SEQUENCE_INVALID_SOURCE_ID: 'Use the exact authorized Asset ID and a valid local source ID. Omit renditionId to use original.',
    MEDIA_SEQUENCE_SOURCE_METADATA_PENDING: 'The selected source metadata is not ready. Wait for its existing preparation to finish before resolving it again; do not invent timing or dimensions.',
}

// These codes come from infrastructure, authorization or tenancy checks; the model cannot correct them by changing its request.
const fatalSequenceErrors = new Set([
    'MEDIA_SEQUENCE_EDITING_UNAVAILABLE',
    'MEDIA_SEQUENCE_CATALOG_STORAGE_UNAVAILABLE',
    'MEDIA_SEQUENCE_UNKNOWN_TOOL',
    'MEDIA_SEQUENCE_INVALID_MUTATION_ORIGIN',
])

const recoverableRenderErrors = new Set([
    'MEDIA_RENDER_UNAVAILABLE',
    'MEDIA_RENDER_INVALID_PRESET',
    'MEDIA_RENDER_INVALID_BITRATE',
    'MEDIA_RENDER_INVALID_NUMBER',
    'MEDIA_RENDER_INVALID_CROP',
    'MEDIA_RENDER_INVALID_TEXT',
    'MEDIA_RENDER_INVALID_MUTATION_ID',
    'MEDIA_RENDER_IDEMPOTENCY_CONFLICT',
    'MEDIA_RENDER_MISSING_VISUAL_SOURCE',
    'MEDIA_RENDER_SOURCE_UNAVAILABLE',
    'MEDIA_RENDER_SOURCE_BINDING_CHANGED',
    'MEDIA_RENDER_SOURCE_LIMIT',
    'MEDIA_RENDER_MANIFEST_LIMIT',
    'MEDIA_RENDER_RESOURCE_LIMIT',
    'MEDIA_RENDER_DISK_LIMIT',
])

const recoverableToolErrorMessage = (
    tool: string,
    message: string,
): string | undefined => {
    const code = message.split(':')[0]

    if (Object.hasOwn(sourceErrors, code))
        return sourceErrors[code]

    if (
        tool === 'export_sequence'
        && recoverableRenderErrors.has(code)
    )
        return `The export was rejected with ${code} before any render started. Read the sequence, correct the revision, preset or sources, and retry with a new clientMutationId. Tell the user when the requested output cannot be produced with the available presets or limits.`

    if (
        code.startsWith('MEDIA_SEQUENCE_')
        && !fatalSequenceErrors.has(code)
    )
        return `Sequence validation rejected the request with ${message}. Nothing was committed. Read the current sequence with get_sequence, correct the request, and retry with a new clientMutationId. Do not unlock a locked track without an explicit user instruction.`

    return undefined
}

export const createMediaSequenceAgentTools = (
    execute: (
        action: string,
        request: Readonly<Record<string, unknown>>,
        context: CapabilityActionAuthorizationContext,
    ) => Promise<unknown>,
    resolveSources = false,
): CapabilityAgentTool[] => {
    const id = sequenceIdSchema
    const revision = {
        type: 'integer',
        minimum: 1,
    }
    const schemas: Record<string, Record<string, unknown>> = {
        get_sequence: {
            type: 'object',
            properties: {
                sequenceId: id,
                revision,
            },
            required: ['sequenceId'],
            additionalProperties: false,
        },
        ...(resolveSources ? { resolve_sequence_source: {
            type: 'object',
            properties: {
                sourceId: id,
                assetId: id,
                renditionId: {
                    ...id,
                    description: 'Existing rendition name. Omit to select original; never invent a rendition name.',
                },
            },
            required: ['sourceId', 'assetId'],
            additionalProperties: false,
        } } : {}),
        create_sequence: {
            type: 'object',
            properties: {
                sequenceId: id,
                name: {
                    type: 'string',
                    minLength: 1,
                },
                clientMutationId: id,
            },
            required: ['sequenceId', 'name', 'clientMutationId'],
            additionalProperties: false,
        },
        patch_sequence: sequencePatchRequestSchema,
        export_sequence: {
            type: 'object',
            properties: {
                sequenceId: id,
                revision,
                clientMutationId: id,
                preset: sequenceExportSchema,
            },
            required: ['sequenceId', 'revision', 'clientMutationId', 'preset'],
            additionalProperties: false,
        },
    }
    const descriptions: Record<string, string> = {
        get_sequence: 'Read the exact sequence revision, tracks, immutable source bindings, clips, keyframes, and transitions before editing.',
        resolve_sequence_source: 'Resolve an authorized source Asset into its canonical immutable source binding before adding it to a sequence or drafting a pipeline. Omit renditionId to select original. Only specify another rendition when its existing name is known; source is not a rendition name. Reuse returned metadata exactly. This reads metadata and never creates a sequence, renders, or generates media.',
        create_sequence: `Create an explicitly requested empty media sequence Artifact. Sources and clips are added through patch_sequence. ${sequenceCreationDescription}`,
        patch_sequence: `Apply ordered nondestructive edits through the typed sequence patch API. Read the target sequence time base before editing. All time is integer ticks: source in/out use source time base, all other times use sequence time base. ${sequenceCreationDescription} Clip duration equals source range converted at playback rate. Images and text use sourceIn=sourceOut=0. Transform x/y are output pixels before rotation; crop is source pixel amounts. Locked tracks reject edits. Resolve source metadata before adding it. A conflict returns latest revision and changed objects.`,
        export_sequence: 'Render an explicitly requested frozen sequence revision to an available MP4, WAV, or MP3 preset. Returns a durable operation handle; no speculative output URL.',
    }

    return Object.entries(schemas).map(
        ([name, schema]) => ({
            name,
            schema,
            description: descriptions[name],
            intent: ['get_sequence', 'resolve_sequence_source'].includes(name) ? 'inspect' : 'execute',
            operationFamilies: ['get_sequence', 'resolve_sequence_source'].includes(name) ? [] : [name === 'export_sequence' ? 'sequence-export' : 'sequence-edit'],
            execute: async (input, context) => {
                let result: unknown

                try {
                    result = await execute(
                        name,
                        input,
                        context,
                    )
                } catch (error) {
                    const message = recoverableToolErrorMessage(name, error instanceof Error ? error.message : '')

                    if (!message)
                        throw error

                    return {
                        status: 'error',
                        error: {
                            code: (error as Error).message.split(':')[0],
                            message,
                            recoverable: true,
                        },
                        sources: [],
                    }
                }

                const record = result
                    && typeof result === 'object'
                    ? result as Record<string, unknown>
                    : undefined

                if (record?.status === 'conflict')
                    return {
                        status: 'error',
                        error: {
                            code: 'MEDIA_SEQUENCE_REVISION_CONFLICT',
                            message: record.message,
                            recoverable: true,
                            changedObjectIds: record.changedObjectIds,
                        },
                        data: result,
                        sources: [],
                    }

                if (
                    name === 'export_sequence'
                    && typeof record?.operationId === 'string'
                )
                    return {
                        status: 'pending',
                        operationId: record.operationId,
                    }

                return {
                    status: 'completed',
                    data: result,
                    sources: [],
                }
            },
        }),
    )
}

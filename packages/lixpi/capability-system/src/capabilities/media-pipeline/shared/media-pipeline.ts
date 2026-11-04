import {
    type CapabilityJsonValue,
} from '@lixpi/constants'
import { Schema } from 'prosemirror-model'

import {
    type CapabilityArtifactSharedDefinition,
} from '../../../shared/capability-artifact.ts'
import { validateJsonSchemaValue } from '../../../shared/capability-json-schema.ts'

export const MEDIA_PIPELINE_MODULE_ID = 'media-pipeline'
export const MEDIA_PIPELINE_ARTIFACT_TYPE_ID = 'media-pipeline'
export const MEDIA_PIPELINE_SCHEMA_VERSION = 'media-pipeline-v1'
export const MEDIA_PIPELINE_SKILL_ID = 'global.media-pipeline-planning'
export const MEDIA_PIPELINE_LIMITS = Object.freeze({
    nodes: 128,
    sources: 128,
    edges: 512,
    concurrency: 8,
    fanout: 32,
})

export type MediaPipelineKind = 'text' | 'image' | 'video' | 'audio' | 'artifact' | 'sequence'
export type MediaPipelineSource = {
    sourceId: string
    assetId: string
    revision: number
    kind: MediaPipelineKind
    blobHash?: string
    documentVersion?: number
    renditionId?: string
}
export type MediaPipelinePort = {
    portId: string
    kind: MediaPipelineKind
    required: boolean
}
export type MediaPipelineNode = {
    nodeId: string
    operationKey: string
    modelId?: string
    parameters: Record<string, CapabilityJsonValue>
    inputs: MediaPipelinePort[]
    outputs: MediaPipelinePort[]
}
export type MediaPipelineEdge = {
    from: { sourceId: string } | {
        nodeId: string
        portId: string
    }
    to: {
        nodeId: string
        portId: string
    }
}
export type MediaPipelineOutputBinding = {
    outputId: string
    nodeId: string
    portId: string
}
export type MediaPipelinePlan = {
    name?: string
    requestedOutcome: string
    constraints: string[]
    sources: MediaPipelineSource[]
    nodes: MediaPipelineNode[]
    edges: MediaPipelineEdge[]
    executionPolicy: {
        maxConcurrency: number
        maxFanout: number
    }
    outputBindings: MediaPipelineOutputBinding[]
}
export type MediaPipeline = MediaPipelinePlan & {
    schemaVersion: typeof MEDIA_PIPELINE_SCHEMA_VERSION
    pipelineId: string
    revision: number
    origin: {
        conversationAssetId: string
        turnId: string
    }
}
export type MediaPipelinePatch = Partial<MediaPipelinePlan>
export type MediaPipelineIssue = {
    code: string
    message: string
    nodeId?: string
    sourceId?: string
    recoverable: boolean
}

const identifierSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 160,
    pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$',
}
const nodeIdentifierSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$',
}
const kindSchema = { enum: ['text', 'image', 'video', 'audio', 'artifact', 'sequence'] }
const portSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['portId', 'kind', 'required'],
    properties: {
        portId: identifierSchema,
        kind: kindSchema,
        required: { type: 'boolean' },
    },
}
const nodePortSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['nodeId', 'portId'],
    properties: {
        nodeId: nodeIdentifierSchema,
        portId: identifierSchema,
    },
}

export const mediaPipelinePlanProperties = {
    name: {
        type: 'string',
        minLength: 1,
        maxLength: 160,
        pattern: '\\S',
        description: 'Human-readable pipeline name, separate from its server-assigned pipelineId.',
    },
    requestedOutcome: {
        type: 'string',
        minLength: 1,
        maxLength: 8000,
    },
    constraints: {
        type: 'array',
        maxItems: 128,
        items: {
            type: 'string',
            minLength: 1,
            maxLength: 4000,
        },
    },
    sources: {
        type: 'array',
        maxItems: MEDIA_PIPELINE_LIMITS.sources,
        items: {
            type: 'object',
            additionalProperties: false,
            required: ['sourceId', 'assetId', 'revision', 'kind'],
            properties: {
                sourceId: identifierSchema,
                assetId: identifierSchema,
                revision: {
                    type: 'integer',
                    minimum: 1,
                },
                kind: kindSchema,
                blobHash: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 256,
                },
                documentVersion: {
                    type: 'integer',
                    minimum: 1,
                },
                renditionId: identifierSchema,
            },
            anyOf: [{ required: ['blobHash'] }, { required: ['documentVersion'] }],
        },
    },
    nodes: {
        type: 'array',
        minItems: 1,
        maxItems: MEDIA_PIPELINE_LIMITS.nodes,
        items: {
            type: 'object',
            additionalProperties: false,
            required: ['nodeId', 'operationKey', 'parameters', 'inputs', 'outputs'],
            properties: {
                nodeId: nodeIdentifierSchema,
                operationKey: identifierSchema,
                modelId: identifierSchema,
                parameters: { type: 'object' },
                inputs: {
                    type: 'array',
                    maxItems: 32,
                    items: portSchema,
                },
                outputs: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 32,
                    items: portSchema,
                },
            },
        },
    },
    edges: {
        type: 'array',
        maxItems: MEDIA_PIPELINE_LIMITS.edges,
        items: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'to'],
            properties: {
                from: {
                    oneOf: [
                        {
                            type: 'object',
                            additionalProperties: false,
                            required: ['sourceId'],
                            properties: { sourceId: identifierSchema },
                        },
                        nodePortSchema,
                    ],
                },
                to: nodePortSchema,
            },
        },
    },
    executionPolicy: {
        type: 'object',
        additionalProperties: false,
        required: ['maxConcurrency', 'maxFanout'],
        properties: {
            maxConcurrency: {
                type: 'integer',
                minimum: 1,
                maximum: MEDIA_PIPELINE_LIMITS.concurrency,
            },
            maxFanout: {
                type: 'integer',
                minimum: 1,
                maximum: MEDIA_PIPELINE_LIMITS.fanout,
            },
        },
    },
    outputBindings: {
        type: 'array',
        minItems: 1,
        maxItems: 128,
        items: {
            type: 'object',
            additionalProperties: false,
            required: ['outputId', 'nodeId', 'portId'],
            properties: {
                outputId: identifierSchema,
                nodeId: nodeIdentifierSchema,
                portId: identifierSchema,
            },
        },
    },
}

export const mediaPipelineSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['schemaVersion', 'pipelineId', 'revision', 'origin', ...Object.keys(mediaPipelinePlanProperties).filter(key => key !== 'name')],
    properties: {
        schemaVersion: { const: MEDIA_PIPELINE_SCHEMA_VERSION },
        pipelineId: identifierSchema,
        revision: {
            type: 'integer',
            minimum: 1,
        },
        origin: {
            type: 'object',
            additionalProperties: false,
            required: ['conversationAssetId', 'turnId'],
            properties: {
                conversationAssetId: identifierSchema,
                turnId: identifierSchema,
            },
        },
        ...mediaPipelinePlanProperties,
    },
}

export const validateMediaPipeline = (value: unknown): MediaPipelineIssue[] => {
    const validation = validateJsonSchemaValue(mediaPipelineSchema, value)

    if (!validation.valid)
        return validation.errors.map(
            message => ({
                code: 'PIPELINE_SCHEMA_INVALID',
                message,
                recoverable: true,
            }),
        )

    const pipeline = value as MediaPipeline
    const issues: MediaPipelineIssue[] = []
    const fail = (
        code: string,
        message: string,
        nodeId?: string,
    ): void =>
        void issues.push({
            code,
            message,
            ...(nodeId ? { nodeId } : {}),
            recoverable: true,
        })
    const sources = new Map(
        pipeline.sources.map(source => [source.sourceId, source]),
    )
    const nodes = new Map(
        pipeline.nodes.map(node => [node.nodeId, node]),
    )

    if (sources.size !== pipeline.sources.length)
        fail('PIPELINE_SOURCE_DUPLICATE', 'Source IDs must be unique.')

    if (nodes.size !== pipeline.nodes.length)
        fail('PIPELINE_NODE_DUPLICATE', 'Node IDs must be unique.')

    for (const node of pipeline.nodes) {
        for (const ports of [node.inputs, node.outputs]) {
            if (new Set(
                ports.map(port => port.portId),
            ).size !== ports.length)
                fail(
                    'PIPELINE_PORT_DUPLICATE',
                    'Port IDs must be unique within each input or output list.',
                    node.nodeId,
                )
        }

        if (!isJsonValue(node.parameters))
            fail(
                'PIPELINE_PARAMETERS_INVALID',
                'Parameters must contain bounded JSON values.',
                node.nodeId,
            )
    }

    const connectedInputs = new Set<string>()
    const dependents = new Map<string, Set<string>>()

    for (const edge of pipeline.edges) {
        const target = nodes.get(edge.to.nodeId)?.inputs.find(port => port.portId === edge.to.portId)
        const inputKey = JSON.stringify([edge.to.nodeId, edge.to.portId])

        if (connectedInputs.has(inputKey))
            fail(
                'PIPELINE_INPUT_MULTIPLE_BINDINGS',
                'An input port must have exactly one binding.',
                edge.to.nodeId,
            )

        connectedInputs.add(inputKey)
        const from = edge.from
        const sourceKind = 'sourceId' in from
            ? sources.get(from.sourceId)?.kind
            : nodes.get(from.nodeId)?.outputs.find(port => port.portId === from.portId)?.kind

        if (
            !target
            || !sourceKind
        )
            fail(
                'PIPELINE_EDGE_TARGET_UNKNOWN',
                'Every edge must reference an existing source, node, and port.',
                edge.to.nodeId,
            )
        else if (target.kind !== sourceKind)
            fail(
                'PIPELINE_PORT_KIND_MISMATCH',
                `Cannot connect ${sourceKind} to ${target.kind}.`,
                edge.to.nodeId,
            )

        if ('nodeId' in from) {
            const children = dependents.get(from.nodeId) ?? new Set<string>()
            children.add(edge.to.nodeId)
            dependents.set(from.nodeId, children)
        }
    }

    for (const node of pipeline.nodes) {
        for (const port of node.inputs) {
            if (
                port.required
                && !connectedInputs.has(
                    JSON.stringify([node.nodeId, port.portId]),
                )
            )
                fail(
                    'PIPELINE_REQUIRED_INPUT_MISSING',
                    `Required input ${port.portId} has no binding.`,
                    node.nodeId,
                )
        }

        if ((dependents.get(node.nodeId)?.size ?? 0) > pipeline.executionPolicy.maxFanout)
            fail(
                'PIPELINE_FANOUT_EXCEEDED',
                'Node fanout exceeds the execution policy.',
                node.nodeId,
            )
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (nodeId: string): void => {
        if (visiting.has(nodeId)) {
            fail(
                'PIPELINE_CYCLE',
                'Pipeline dependencies must be acyclic.',
                nodeId,
            )

            return
        }

        if (visited.has(nodeId))
            return

        visiting.add(nodeId)

        for (const dependent of dependents.get(nodeId) ?? [])
            visit(dependent)

        visiting.delete(nodeId)
        visited.add(nodeId)
    }

    for (const nodeId of nodes.keys())
        visit(nodeId)

    if (new Set(
        pipeline.outputBindings.map(output => output.outputId),
    ).size !== pipeline.outputBindings.length)
        fail('PIPELINE_OUTPUT_DUPLICATE', 'Output binding IDs must be unique.')

    for (const output of pipeline.outputBindings) {
        if (!nodes.get(output.nodeId)?.outputs.some(port => port.portId === output.portId))
            fail(
                'PIPELINE_OUTPUT_UNKNOWN',
                'Output bindings must reference an existing output port.',
                output.nodeId,
            )
    }

    return issues
}

export const assertMediaPipeline = (value: unknown): MediaPipeline => {
    const issues = validateMediaPipeline(value)

    if (issues.length)
        throw new Error(`${issues[0].code}:${issues[0].message}`)

    return value as MediaPipeline
}

export const createMediaPipelineDocument = (pipeline: MediaPipeline): object => ({
    type: 'doc',
    content: [{
        type: 'mediaPipeline',
        attrs: { pipeline: assertMediaPipeline(pipeline) },
    }],
})

export const readMediaPipelineDocument = (document: object): MediaPipeline => {
    const parsed = document as {
        type?: unknown
        content?: Array<{
            type?: unknown
            attrs?: { pipeline?: unknown }
        }>
    }

    if (
        parsed.type !== 'doc'
        || parsed.content?.length !== 1
        || parsed.content[0].type !== 'mediaPipeline'
    )
        throw new Error('PIPELINE_DOCUMENT_INVALID')

    return assertMediaPipeline(parsed.content[0].attrs?.pipeline)
}

export const mediaPipelineSharedDefinition: CapabilityArtifactSharedDefinition = {
    artifactTypeId: MEDIA_PIPELINE_ARTIFACT_TYPE_ID,
    displayName: 'Media Pipeline',
    schemaVersion: MEDIA_PIPELINE_SCHEMA_VERSION,
    allowedEmbeddedReferenceTypes: [],
    createDocumentSchema: () => new Schema({
        nodes: {
            doc: { content: 'mediaPipeline' },
            text: {},
            mediaPipeline: {
                atom: true,
                attrs: { pipeline: { default: null } },
                toDOM: () => ['section', { class: 'media-pipeline-artifact' }],
            },
        },
    }),
    assertInitialDocument: document => void readMediaPipelineDocument(document),
    assertEditableMutation: (previous, next) => {
        if (JSON.stringify(previous) !== JSON.stringify(next))
            throw new Error('PIPELINE_TYPED_PATCH_REQUIRED')
    },
    collectReferencedAssetIds: document => [...new Set(
        readMediaPipelineDocument(document).sources.map(source => source.assetId),
    )],
    collectOperationKeys: document => [...new Set(
        readMediaPipelineDocument(document).nodes.map(node => node.operationKey),
    )],
    collectSourceReferences: document => readMediaPipelineDocument(document).sources.map(
        source => ({
            assetId: source.assetId,
            role: ['image', 'video', 'audio'].includes(source.kind)
                ? 'media' as const
                : source.kind === 'text'
                    ? 'content' as const
                    : 'artifact' as const,
            ...(source.renditionId ? { renditionId: source.renditionId } : {}),
            ...(source.blobHash ? { blobHash: source.blobHash } : {}),
            ...(source.documentVersion ? { documentVersion: source.documentVersion } : {}),
        }),
    ),
    serializeForModel: (document, labels) => {
        const pipeline = readMediaPipelineDocument(document)

        return {
            text: JSON.stringify({
                ...pipeline,
                sources: pipeline.sources.map(
                    source => ({
                        ...source,
                        label: labels.get(source.assetId) ?? source.assetId,
                    }),
                ),
            }),
            referencedAssetIds: [...new Set(
                pipeline.sources.map(source => source.assetId),
            )],
        }
    },
    buildCatalogMetadata: document => {
        const pipeline = readMediaPipelineDocument(document)

        return {
            pipelineId: pipeline.pipelineId,
            revision: pipeline.revision,
            requestedOutcome: pipeline.requestedOutcome,
            nodeCount: pipeline.nodes.length,
        }
    },
}

const isJsonValue = (
    value: unknown,
    depth = 0,
): value is CapabilityJsonValue => {
    if (depth > 32)
        return false

    if (
        value === null
        || typeof value === 'string'
        || typeof value === 'boolean'
    )
        return true

    if (typeof value === 'number')
        return Number.isFinite(value)

    if (Array.isArray(value))
        return value.length <= 1024 && value.every(item => isJsonValue(item, depth + 1))

    return typeof value === 'object' && value !== null
        && Object.keys(value).length <= 256
        && Object.values(value).every(item => isJsonValue(item, depth + 1))
}

import { createHash } from 'node:crypto'
import {
    mediaPipelinePlanProperties,
    type MediaPipelineNode,
    type MediaPipelinePatch,
} from '../shared/media-pipeline.ts'

export type MediaPipelineMatrixInput = {
    pipelineId?: string
    baseRevision: number
    clientMutationId: string
    requestedOutcome: string
    constraints?: string[]
    sources?: MediaPipelinePatch['sources']
    promptVariants: Array<{
        variantId: string
        prompt: string
    }>
    imageModelIds: string[]
    imageSize: string
    maxConcurrency: number
}
export type MediaPipelinePreparedMatrixInput = Omit<MediaPipelineMatrixInput, 'promptVariants'> & {
    instruction: string
    reasoningModelIds: string[]
}

const identifier = {
    type: 'string',
    minLength: 1,
    maxLength: 160,
    pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$',
}
export const mediaPipelineMatrixInputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['baseRevision', 'clientMutationId', 'requestedOutcome', 'promptVariants', 'imageModelIds', 'imageSize', 'maxConcurrency'],
    properties: {
        pipelineId: identifier,
        baseRevision: {
            type: 'integer',
            minimum: 0,
        },
        clientMutationId: identifier,
        requestedOutcome: mediaPipelinePlanProperties.requestedOutcome,
        constraints: mediaPipelinePlanProperties.constraints,
        sources: mediaPipelinePlanProperties.sources,
        promptVariants: {
            type: 'array',
            minItems: 1,
            maxItems: 32,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['variantId', 'prompt'],
                properties: {
                    variantId: identifier,
                    prompt: {
                        type: 'string',
                        minLength: 1,
                        maxLength: 10000,
                    },
                },
            },
        },
        imageModelIds: {
            type: 'array',
            minItems: 1,
            maxItems: 32,
            uniqueItems: true,
            items: identifier,
        },
        imageSize: { enum: ['1:1', '21:9', '16:9', '3:2', '5:4', '4:5', '2:3', '9:16', '9:21'] },
        maxConcurrency: {
            type: 'integer',
            minimum: 1,
            maximum: 8,
        },
    },
}

export const mediaPipelinePreparedMatrixInputSchema = {
    ...mediaPipelineMatrixInputSchema,
    required: [...mediaPipelineMatrixInputSchema.required.filter(key => key !== 'promptVariants'), 'instruction', 'reasoningModelIds'],
    properties: {
        ...Object.fromEntries(
            Object.entries(mediaPipelineMatrixInputSchema.properties).filter(([key]) => key !== 'promptVariants'),
        ),
        instruction: {
            type: 'string',
            minLength: 1,
            maxLength: 10000,
        },
        reasoningModelIds: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
            items: identifier,
        },
    },
}

export const expandMediaPipelineMatrix = (input: MediaPipelineMatrixInput): MediaPipelinePatch => {
    if (input.promptVariants.length * input.imageModelIds.length > 32)
        throw new Error('PIPELINE_MATRIX_FANOUT_EXCEEDED')

    if (new Set(
        input.promptVariants.map(variant => variant.variantId),
    ).size !== input.promptVariants.length)
        throw new Error('PIPELINE_MATRIX_VARIANT_ID_DUPLICATE')

    const nodes: MediaPipelineNode[] = []

    for (const variant of input.promptVariants)
        for (const modelId of input.imageModelIds) {
            const identity = createHash('sha256')
                .update(
                    JSON.stringify([variant.variantId, modelId]),
                )
                .digest('hex')
                .slice(0, 32)
            nodes.push({
                nodeId: `matrix-${identity}`,
                operationKey: 'image.generate',
                modelId,
                parameters: {
                    prompt: variant.prompt,
                    imageSize: input.imageSize,
                },
                inputs: [],
                outputs: [{
                    portId: 'image',
                    kind: 'image',
                    required: true,
                }],
            })
        }

    return {
        requestedOutcome: input.requestedOutcome,
        ...(input.constraints
            ? { constraints: input.constraints }
            : input.pipelineId
                ? {}
                : { constraints: [] }),
        ...(input.sources
            ? { sources: input.sources }
            : input.pipelineId
                ? {}
                : { sources: [] }),
        nodes,
        edges: [],
        executionPolicy: {
            maxConcurrency: input.maxConcurrency,
            maxFanout: 32,
        },
        outputBindings: nodes.map(
            node => ({
                outputId: node.nodeId,
                nodeId: node.nodeId,
                portId: 'image',
            }),
        ),
    }
}

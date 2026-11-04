import { createHash } from 'node:crypto'
import {
    sequenceCreationDescription,
    sequencePatchOperationSchema,
} from '../shared/sequence-json-schema.ts'

import {
    type MediaPipelineSource,
} from '../../media-pipeline/shared/media-pipeline.ts'
import {
    type MediaPipelineOperationHandler,
    type MediaPipelineOperationRequest,
    type MediaPipelineOperationReceipt,
} from '../../media-pipeline/backend/media-pipeline-ports.ts'
import {
    type SequencePatchOperation,
    type SequenceSourceBinding,
} from '../shared/media-sequence.ts'
import {
    type MediaSequenceAccess,
    type MediaSequenceService,
} from './media-sequence-service.ts'

export type MediaSequencePipelinePorts = {
    resolvePipelineSource: (
        access: MediaSequenceAccess,
        input: {
            assetId: string
            kind: 'sequence'
            revision: number
        },
    ) => Promise<MediaPipelineSource>
    resolvePipelineMediaSource: (
        access: MediaSequenceAccess,
        source: MediaPipelineSource,
        sourceId: string,
    ) => Promise<SequenceSourceBinding>
    exportHandler?: Omit<MediaPipelineOperationHandler, 'definition'>
}

export class MediaSequencePipelineOperations {
    constructor(
        private readonly service: MediaSequenceService,
        private readonly ports: MediaSequencePipelinePorts,
    ) {}

    handlers(): MediaPipelineOperationHandler[] {
        const mediaPorts = [
            {
                portId: 'image',
                kind: 'image' as const,
                required: false,
            },
            {
                portId: 'video',
                kind: 'video' as const,
                required: false,
            },
            {
                portId: 'audio',
                kind: 'audio' as const,
                required: false,
            },
        ]
        const properties = {
            name: { type: 'string' },
            operations: {
                type: 'array',
                maxItems: 250,
                items: sequencePatchOperationSchema,
            },
            sourceBindings: {
                type: 'array',
                maxItems: 3,
                items: {
                    type: 'object',
                    properties: {
                        inputPort: { enum: ['image', 'video', 'audio'] },
                        sourceId: { type: 'string' },
                    },
                    required: ['inputPort', 'sourceId'],
                    additionalProperties: false,
                },
            },
        }
        const handlers: MediaPipelineOperationHandler[] = ['sequence.create', 'sequence.revise'].map(
            operationKey => ({
                definition: {
                    operationKey,
                    family: 'sequence-edit',
                    execution: 'local' as const,
                    ready: true,
                    inputPorts: operationKey === 'sequence.create' ? mediaPorts : [{
                        portId: 'sequence',
                        kind: 'sequence' as const,
                        required: true,
                    }, ...mediaPorts],
                    outputPorts: [{
                        portId: 'sequence',
                        kind: 'sequence' as const,
                        required: true,
                    }],
                    parameterSchema: {
                        type: 'object',
                        description: operationKey === 'sequence.create' ? sequenceCreationDescription : 'Read the existing sequence and use its exact time base and output dimensions. Source in/out use the source time base; placement, duration and keyframes use the sequence time base.',
                        properties,
                        required: operationKey === 'sequence.create' ? ['name'] : ['operations'],
                        additionalProperties: false,
                    },
                },
                ensure: request => this.ensure(request),
                read: async () => undefined,
            }),
        )

        if (this.ports.exportHandler)
            handlers.push({
                ...this.ports.exportHandler,
                definition: {
                    operationKey: 'sequence.export',
                    family: 'sequence-export',
                    execution: 'local',
                    ready: true,
                    inputPorts: [{
                        portId: 'sequence',
                        kind: 'sequence',
                        required: true,
                    }],
                    outputPorts: [{
                        portId: 'video',
                        kind: 'video',
                        required: true,
                    }],
                    parameterSchema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['preset'],
                        properties: {
                            preset: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['presetId', 'quality'],
                                properties: {
                                    presetId: { const: 'mp4-h264-aac' },
                                    quality: { enum: ['draft', 'standard', 'high'] },
                                    videoBitrateKbps: {
                                        type: 'integer',
                                        minimum: 100,
                                        maximum: 100000,
                                    },
                                    audioBitrateKbps: {
                                        type: 'integer',
                                        minimum: 32,
                                        maximum: 512,
                                    },
                                },
                            },
                        },
                    },
                },
            })

        return handlers
    }

    private async ensure(request: MediaPipelineOperationRequest): Promise<MediaPipelineOperationReceipt> {
        const access: MediaSequenceAccess = {
            userId: request.context.userId,
            organizationId: request.context.organizationId,
            workspaceId: request.context.workspaceId,
            origin: {
                kind: 'conversation',
                conversationAssetId: request.context.conversationAssetId,
                turnId: request.context.turnId,
                operationId: request.operationId,
            },
        }
        const key = createHash('sha256').update(request.operationId).digest('hex').slice(0, 48)
        const sourceBindings = (request.node.parameters.sourceBindings ?? []) as Array<{
            inputPort: string
            sourceId: string
        }>
        const operations: SequencePatchOperation[] = []

        for (const binding of sourceBindings) {
            const source = request.inputs[binding.inputPort]

            if (!source)
                throw new Error('MEDIA_SEQUENCE_PIPELINE_SOURCE_REQUIRED')

            operations.push({
                op: 'add-source',
                source: await this.ports.resolvePipelineMediaSource(
                    access,
                    source,
                    binding.sourceId,
                ),
            })
        }

        operations.push(...((request.node.parameters.operations ?? []) as unknown as SequencePatchOperation[]))
        let sequenceId: string
        let baseRevision: number

        if (request.node.operationKey === 'sequence.create') {
            sequenceId = `sequence-${key}`
            const created = await this.service.create(
                access,
                {
                    sequenceId,
                    name: String(request.node.parameters.name),
                    clientMutationId: `create-${key}`,
                },
            )

            if (created.status === 'conflict')
                return this.conflict(request, created.message)

            baseRevision = created.sequence.revision
        } else {
            const input = request.inputs.sequence

            if (
                !input
                || input.kind !== 'sequence'
            )
                throw new Error('MEDIA_SEQUENCE_PIPELINE_TARGET_REQUIRED')

            sequenceId = input.assetId
            baseRevision = input.revision
        }

        let revision = baseRevision

        if (operations.length) {
            const result = await this.service.patch(
                access,
                {
                    sequenceId,
                    baseRevision,
                    clientMutationId: `edit-${key}`,
                    operations,
                },
            )

            if (result.status === 'conflict')
                return this.conflict(request, result.message)

            revision = result.sequence.revision
        }

        const source = await this.ports.resolvePipelineSource(
            access,
            {
                assetId: sequenceId,
                kind: 'sequence',
                revision,
            },
        )

        return {
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'succeeded',
            outputs: { sequence: source },
        }
    }

    private conflict(
        request: MediaPipelineOperationRequest,
        message: string,
    ): MediaPipelineOperationReceipt {
        return {
            operationId: request.operationId,
            inputHash: request.inputHash,
            state: 'failed',
            outputs: {},
            error: {
                code: 'MEDIA_SEQUENCE_REVISION_CONFLICT',
                message,
                recoverable: true,
            },
        }
    }
}

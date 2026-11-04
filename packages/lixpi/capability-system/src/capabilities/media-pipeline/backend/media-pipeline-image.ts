import {
    type MediaPipelineOperationHandler,
    type MediaPipelineOperationRequest,
} from './media-pipeline-ports.ts'

export const createMediaPipelineImageHandler = (executor: Omit<MediaPipelineOperationHandler, 'definition'>): MediaPipelineOperationHandler => ({
    ...executor,
    definition: {
        operationKey: 'image.generate',
        family: 'image',
        execution: 'inference',
        ready: true,
        inputPorts: [],
        outputPorts: [{
            portId: 'image',
            kind: 'image',
            required: true,
        }],
        parameterSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt', 'imageSize'],
            properties: {
                prompt: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 10000,
                },
                imageSize: { enum: ['1:1', '21:9', '16:9', '3:2', '5:4', '4:5', '2:3', '9:16', '9:21'] },
            },
        },
    },
})

export const buildMediaPipelineImageProvenance = (
    request: MediaPipelineOperationRequest,
    output: {
        assetId: string
        blobHash: string
        seed: number
    },
): object => {
    const paragraph = (text: string) => ({
        type: 'paragraph',
        content: [{
            type: 'text',
            text,
        }],
    })

    return {
        type: 'doc',
        content: [{
            type: 'aiChatThread',
            attrs: {
                threadId: request.context.conversationAssetId,
                status: 'completed',
            },
            content: [{
                type: 'aiResponseMessage',
                attrs: {
                    id: request.context.responseMessageId,
                    mediaRunId: request.operationId,
                    mediaType: 'image',
                },
                content: [
                    paragraph(`Pipeline ${request.pipelineId}, revision ${request.pipelineRevision}, step ${request.node.nodeId}.`),
                    paragraph(`Operation ${request.operationId}. Input SHA-256 ${request.inputHash}.`),
                    paragraph(`Model ${request.node.modelId}. Inference provider aws-bedrock. Seed ${output.seed}.`),
                    paragraph(`Prompt: ${String(request.node.parameters.prompt)}`),
                    ...[...new Map(
                        [...request.sourceSnapshots ?? [], ...Object.values(request.inputs)].map(source => [source.sourceId, source]),
                    ).values()].map(
                        source => paragraph(
                            `Source Asset ${source.assetId}, revision ${source.revision}, SHA-256 ${source.blobHash ?? 'document snapshot'}.`,
                        ),
                    ),
                    paragraph(`Output Asset ${output.assetId}. SHA-256 ${output.blobHash}.`),
                ],
            }],
        }],
    }
}

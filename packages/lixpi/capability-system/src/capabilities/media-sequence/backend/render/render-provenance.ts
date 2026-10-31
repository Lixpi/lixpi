import {
    type MediaRenderPlan,
    type MediaRenderResult,
} from './render-contract.ts'

export type MediaRenderEvidence = {
    schemaVersion: 'media-sequence-render-v1'
    jobId: string
    attempt: number
    sequenceId: string
    sequenceRevision: number
    presetId: MediaRenderResult['presetId']
    sources: Array<Pick<MediaRenderPlan['inputs'][number], 'assetId' | 'renditionId' | 'blobHash' | 'byteSize'>>
    output: Pick<MediaRenderResult, 'outputAssetId' | 'blobHash' | 'byteSize' | 'mimeType' | 'durationSeconds'>
}

export const buildMediaRenderProvenance = (
    result: MediaRenderResult,
    inputs: MediaRenderPlan['inputs'],
    conversationAssetId?: string,
): {
    document: object
    evidence: MediaRenderEvidence
} => {
    const evidence: MediaRenderEvidence = {
        schemaVersion: 'media-sequence-render-v1',
        jobId: result.jobId,
        attempt: result.attempt,
        sequenceId: result.sequenceId,
        sequenceRevision: result.sequenceRevision,
        presetId: result.presetId,
        sources: inputs.map(
            ({
                assetId,
                renditionId,
                blobHash,
                byteSize,
            }) => ({
                assetId,
                renditionId,
                blobHash,
                byteSize,
            }),
        ),
        output: {
            outputAssetId: result.outputAssetId,
            blobHash: result.blobHash,
            byteSize: result.byteSize,
            mimeType: result.mimeType,
            durationSeconds: result.durationSeconds,
        },
    }
    const paragraph = (text: string) => ({
        type: 'paragraph',
        content: [{
            type: 'text',
            text,
        }],
    })

    return {
        evidence,
        document: {
            type: 'doc',
            content: [{
                type: 'aiChatThread',
                attrs: {
                    threadId: conversationAssetId ?? result.jobId,
                    status: 'completed',
                },
                content: [{
                    type: 'aiResponseMessage',
                    attrs: {
                        mediaRunId: result.jobId,
                        mediaType: result.mimeType.startsWith('video/') ? 'video' : 'audio',
                    },
                    content: [
                        paragraph(`Exported sequence ${result.sequenceId}, revision ${result.sequenceRevision}, as ${result.presetId}.`),
                        paragraph(`Render attempt ${result.attempt}. Duration ${result.durationSeconds} seconds.`),
                        ...inputs.map(input => paragraph(`Source Asset ${input.assetId}, rendition ${input.renditionId}, SHA-256 ${input.blobHash}.`)),
                        paragraph(`Output SHA-256 ${result.blobHash}.`),
                    ],
                }],
            }],
        },
    }
}

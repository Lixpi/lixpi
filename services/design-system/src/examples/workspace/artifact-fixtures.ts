import { mediaFixtures } from './media-fixtures.ts'
import {
    CapabilityArtifactFrontendRegistry,
    createMediaPipelineFrontendDefinition,
    mediaSequenceFrontendDefinition,
    MEDIA_SEQUENCE_FRONTEND_STYLES,
} from '@lixpi/capability-system/frontend'
import {
    CapabilityArtifactSharedRegistry,
    createMediaPipelineDocument,
    createMediaSequenceDocument,
    mediaPipelineSharedDefinition,
    mediaSequenceArtifactDefinition,
    type MediaPipeline,
    type MediaSequence,
} from '@lixpi/capability-system/shared'
import { html } from '@lixpi/ui-primitives/dom'

export const createArtifactFixtures = () => {
    const shared = new CapabilityArtifactSharedRegistry()
    shared.register(mediaPipelineSharedDefinition)
    shared.register(mediaSequenceArtifactDefinition)
    const frontend = new CapabilityArtifactFrontendRegistry()
    frontend.register(
        createMediaPipelineFrontendDefinition(),
    )
    frontend.register(mediaSequenceFrontendDefinition)

    const pipeline: MediaPipeline = {
        schemaVersion: 'media-pipeline-v1',
        pipelineId: 'fixture-pipeline',
        revision: 1,
        name: 'Reference to composition',
        requestedOutcome: 'A saved plan for arranging the supplied reference.',
        constraints: ['Retain the supplied source identity.'],
        sources: [{
            sourceId: 'source-image',
            assetId: 'fixture-image',
            revision: 1,
            blobHash: mediaFixtures.image.blobHash,
            kind: 'image',
        }],
        nodes: [{
            nodeId: 'compose',
            operationKey: 'sequence.create',
            parameters: {},
            inputs: [{
                portId: 'image',
                kind: 'image',
                required: true,
            }],
            outputs: [{
                portId: 'result',
                kind: 'sequence',
                required: true,
            }],
        }],
        edges: [{
            from: { sourceId: 'source-image' },
            to: {
                nodeId: 'compose',
                portId: 'image',
            },
        }],
        executionPolicy: {
            maxConcurrency: 1,
            maxFanout: 1,
        },
        outputBindings: [{
            outputId: 'composition',
            nodeId: 'compose',
            portId: 'result',
        }],
        origin: {
            conversationAssetId: 'fixture-conversation',
            turnId: 'fixture-turn',
        },
    }
    const sequence: MediaSequence = {
        schemaVersion: 'media-sequence-v1',
        sequenceId: 'fixture-sequence',
        revision: 1,
        name: 'Canvas sequence',
        timeBase: {
            numerator: 1,
            denominator: 240000,
        },
        frameRate: {
            numerator: 30,
            denominator: 1,
        },
        width: 1920,
        height: 1080,
        audioSampleRate: 48000,
        duration: 1440000,
        tracks: [{
            trackId: 'video',
            name: 'Video',
            kind: 'video',
            locked: false,
            visible: true,
            muted: false,
            solo: false,
        }],
        sources: [{
            sourceId: 'source-image',
            assetId: 'fixture-image',
            renditionId: 'original',
            blobHash: mediaFixtures.image.blobHash,
            byteSize: mediaFixtures.image.byteSize,
            kind: 'image',
            timeBase: {
                numerator: 1,
                denominator: 240000,
            },
            duration: 1440000,
            width: mediaFixtures.image.width,
            height: mediaFixtures.image.height,
        }],
        clips: [{
            clipId: 'reference-clip',
            trackId: 'video',
            sourceId: 'source-image',
            sourceIn: 0,
            sourceOut: 0,
            start: 0,
            duration: 1440000,
            rate: {
                numerator: 1,
                denominator: 1,
            },
            transform: {
                x: 0,
                y: 0,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                opacity: 1,
                crop: {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                },
            },
            audio: {
                gain: 1,
                pan: 0,
                muted: false,
            },
            keyframes: [],
        }],
        transitions: [],
        exportDefaults: {
            presetId: 'mp4-h264-aac',
            quality: 'standard',
        },
    }

    return {
        frontend,
        shared,
        documents: new Map<string, object>([
            ['fixture-pipeline', createMediaPipelineDocument(pipeline)],
            ['fixture-sequence', createMediaSequenceDocument(sequence)],
        ]),
    }
}

export const ensureArtifactStyles = (document: Document): void => {
    if (document.getElementById('canvas-library-artifact-styles'))
        return

    document.head.append(
        html`<style id="canvas-library-artifact-styles">${MEDIA_SEQUENCE_FRONTEND_STYLES}</style>` as HTMLStyleElement,
    )
}

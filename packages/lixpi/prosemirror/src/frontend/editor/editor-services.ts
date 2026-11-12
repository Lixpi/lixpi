import {
    type AiModel,
    type CapabilityJsonValue,
    type MediaGenerationConfigMatrix,
} from '@lixpi/constants'
import {
    type GeneratedMediaModelBadge,
    type MediaUrlResolver,
    type RichEditingPorts,
} from '@lixpi/prosemirror/frontend/rich-editing'

import {
    type EditorAppearanceSettings,
    type EditorPreviewPorts,
    type EditorPromptChromePorts,
} from './editor-host-ports.ts'
import {
    type CapabilityRunProgressFactory,
} from '../plugins/ai-chat-thread/capability-chat-run-progress.ts'
import {
    type SegmentEvent,
} from '../plugins/ai-chat-thread/ai-chat-thread-plugin.ts'
import {
    type PromptModelControlHelpers,
} from '../plugins/ai-prompt-input/prompt-model-controls.ts'

export type EditorMedia = {
    resolveUrl: MediaUrlResolver
    // The API path of one rendition of an asset, such as its preview.
    renditionPath: (
        assetId: string,
        rendition: string,
    ) => string
    modelBadge: GeneratedMediaModelBadge
    downloadImage?: (src: string) => Promise<void>
}

export type EditorModelCatalog = {
    getModels: () => AiModel[]
    getMediaGenerationConfigMatrix: () => MediaGenerationConfigMatrix
    // Calls back whenever the catalog changes.
    subscribe: (listener: () => void) => () => void
}

// Streamed response segments, routed by conversation.
export type ThreadSegmentSource = {
    subscribeForThread: (
        threadId: string,
        listener: (event: SegmentEvent) => void,
    ) => () => void
}

export type EditorCapabilityArtifacts = {
    createPromptReferenceView: (
        artifactTypeId: string,
        options: {
            container: HTMLElement
            title: string
            displayMetadata: Record<string, CapabilityJsonValue>
        },
    ) => { destroy: () => void }
    icon: (artifactTypeId: string) => string
    ensureStyles: (document: Document) => void
}

// Everything the editor features need from the application. The host builds
// one and passes it in each view's context.
export type EditorServices = {
    media: EditorMedia
    settings: EditorAppearanceSettings
    previews: EditorPreviewPorts
    promptChrome: EditorPromptChromePorts
    models: EditorModelCatalog
    segments: ThreadSegmentSource
    capabilityArtifacts: EditorCapabilityArtifacts
    createCapabilityRunProgress: CapabilityRunProgressFactory
    modelControls: PromptModelControlHelpers
}

export const richEditingPortsFrom = (services: EditorServices): RichEditingPorts => ({
    resolveMediaUrl: services.media.resolveUrl,
    modelBadge: services.media.modelBadge,
    downloadImage: services.media.downloadImage,
})

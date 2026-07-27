'use strict'

import type {
    CapabilityArtifactCanvasNode,
    CapabilityJsonValue,
} from '@lixpi/constants'
import type { Schema } from 'prosemirror-model'
import type { Plugin } from 'prosemirror-state'

export type CapabilityPromptControlHost = {
    container: HTMLElement
    initialValue?: Record<string, CapabilityJsonValue>
    setValue: (value: Record<string, CapabilityJsonValue> | undefined) => void
    setValid: (valid: boolean, message?: string) => void
}

export type CapabilityPromptControls = {
    destroy: () => void
    hydrateText?: (text: string) => void
}

export type CapabilityArtifactCanvasHost = {
    container: HTMLElement
    node: CapabilityArtifactCanvasNode
    document: object
    createAssetReferenceView: (request: CapabilityArtifactAssetReferenceRequest) => CapabilityArtifactAssetReferenceView | undefined
    onHeightChange: (height: number) => void
    mountEditor?: (request: {
        container: HTMLElement
        document: object
        schema: Schema
        plugins: Plugin[]
    }) => {
        destroy: () => void
        updateDocument: (document: object) => void
    }
}

export type CapabilityArtifactAssetReferenceRequest = {
    assetId: string
    displayName?: string
    variant: 'inline' | 'thumbnail'
}

export type CapabilityArtifactAssetReferenceView = {
    dom: HTMLElement
    destroy: () => void
}

export type CapabilityArtifactCanvasView = {
    destroy: () => void
    updateDocument: (document: object) => void
}

export type CapabilityArtifactInfoHost = {
    container: HTMLElement
    document: object
}

export type CapabilityArtifactInfoView = {
    destroy: () => void
}

export type CapabilityArtifactReplayHost = {
    provenance: Record<string, CapabilityJsonValue>
}

export type CapabilityReplaySubmitData = {
    capabilityId: string
    capabilityInputs: Record<string, Record<string, CapabilityJsonValue>>
    reasoningModelIds: string[]
}

export type CapabilityPromptReferenceHost = {
    container: HTMLElement
    title: string
    displayMetadata: Record<string, CapabilityJsonValue>
}

export type CapabilityPromptReferenceView = {
    destroy: () => void
}

export type CapabilityArtifactLibraryHost = CapabilityPromptReferenceHost & {
    scope: 'workspace' | 'user' | 'organization'
    onAddToCanvas: () => void
}

export type CapabilityArtifactLibraryView = {
    destroy: () => void
}

export type CapabilityArtifactFrontendDefinition = {
    artifactTypeId: string
    createEditorPlugins?: () => Plugin[]
    createPromptControls?: (host: CapabilityPromptControlHost) => CapabilityPromptControls
    createCanvasNodeView: (host: CapabilityArtifactCanvasHost) => CapabilityArtifactCanvasView
    createGeneratedOutputInfoView: (host: CapabilityArtifactInfoHost) => CapabilityArtifactInfoView
    buildReplaySubmitData: (host: CapabilityArtifactReplayHost) => CapabilityReplaySubmitData
    createPromptReferenceView: (host: CapabilityPromptReferenceHost) => CapabilityPromptReferenceView
    createLibraryItemView: (host: CapabilityArtifactLibraryHost) => CapabilityArtifactLibraryView
}

export class CapabilityArtifactFrontendRegistry {
    private readonly definitions = new Map<string, CapabilityArtifactFrontendDefinition>()

    register(definition: CapabilityArtifactFrontendDefinition): void {
        assertCompleteFrontendDefinition(definition)
        if (this.definitions.has(definition.artifactTypeId)) {
            throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_ALREADY_REGISTERED:${definition.artifactTypeId}`)
        }
        this.definitions.set(definition.artifactTypeId, Object.freeze({ ...definition }))
    }

    get(artifactTypeId: string): CapabilityArtifactFrontendDefinition | undefined {
        return this.definitions.get(artifactTypeId)
    }

    require(artifactTypeId: string): CapabilityArtifactFrontendDefinition {
        const definition = this.get(artifactTypeId)
        if (!definition) throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_UNKNOWN:${artifactTypeId}`)
        return definition
    }

    list(): CapabilityArtifactFrontendDefinition[] {
        return [...this.definitions.values()]
    }
}

function assertCompleteFrontendDefinition(definition: CapabilityArtifactFrontendDefinition): void {
    if (!definition.artifactTypeId.trim()) throw new Error('CAPABILITY_ARTIFACT_FRONTEND_TYPE_ID_REQUIRED')
    const requiredFactories = [
        definition.createCanvasNodeView,
        definition.createGeneratedOutputInfoView,
        definition.buildReplaySubmitData,
        definition.createPromptReferenceView,
        definition.createLibraryItemView,
    ]
    if (requiredFactories.some(factory => typeof factory !== 'function')) {
        throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_INCOMPLETE:${definition.artifactTypeId}`)
    }
}

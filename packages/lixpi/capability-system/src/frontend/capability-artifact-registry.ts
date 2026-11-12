import {
    type CapabilityArtifactCanvasNode,
    type CapabilityJsonValue,
} from '@lixpi/constants'
import {
    type DocumentViewDefinition,
} from '@lixpi/prosemirror/frontend/document-view'

export type CapabilityPromptControlHost = {
    container: HTMLElement
    initialValue?: Record<string, CapabilityJsonValue>
    setValue: (value: Record<string, CapabilityJsonValue> | undefined) => void
    setValid: (
        valid: boolean,
        message?: string,
    ) => void
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
    // Mounts an editable view of the artifact. The host adds its own editing
    // features, such as document sync and prompt references, around the
    // artifact's view definition.
    mountEditor?: (request: {
        container: HTMLElement
        document: object
        documentView: DocumentViewDefinition<unknown>
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
    iconId: string
    // Canvas-unit size used when the artifact is inserted from a library panel.
    // Owned by the capability's settings file so canvas geometry is tuned in one place.
    initialCanvasDimensions: {
        width: number
        height: number
    }
    // The artifact's own editor features for its document kind.
    documentView?: DocumentViewDefinition<unknown>
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

        if (this.definitions.has(definition.artifactTypeId))
            throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_ALREADY_REGISTERED:${definition.artifactTypeId}`)

        this.definitions.set(
            definition.artifactTypeId,
            Object.freeze({ ...definition }),
        )
    }

    get(artifactTypeId: string): CapabilityArtifactFrontendDefinition | undefined {
        return this.definitions.get(artifactTypeId)
    }

    require(artifactTypeId: string): CapabilityArtifactFrontendDefinition {
        const definition = this.get(artifactTypeId)

        if (!definition)
            throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_UNKNOWN:${artifactTypeId}`)

        return definition
    }

    list(): CapabilityArtifactFrontendDefinition[] {
        return [...this.definitions.values()]
    }
}

const assertCompleteFrontendDefinition = (definition: CapabilityArtifactFrontendDefinition): void => {
    if (!definition.artifactTypeId.trim())
        throw new Error('CAPABILITY_ARTIFACT_FRONTEND_TYPE_ID_REQUIRED')

    if (!definition.iconId.trim())
        throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_ICON_REQUIRED:${definition.artifactTypeId}`)

    const {
        width,
        height,
    } = definition.initialCanvasDimensions ?? {}

    if (
        !Number.isFinite(width)
        || width <= 0
        || !Number.isFinite(height)
        || height <= 0
    )
        throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_DIMENSIONS_INVALID:${definition.artifactTypeId}`)

    const requiredFactories = [
        definition.createCanvasNodeView,
        definition.createGeneratedOutputInfoView,
        definition.buildReplaySubmitData,
        definition.createPromptReferenceView,
        definition.createLibraryItemView,
    ]

    if (requiredFactories.some(factory => typeof factory !== 'function'))
        throw new Error(`CAPABILITY_ARTIFACT_FRONTEND_INCOMPLETE:${definition.artifactTypeId}`)
}

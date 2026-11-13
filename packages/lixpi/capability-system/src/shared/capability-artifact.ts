import {
    type CapabilityJsonValue,
    type PromptReferenceType,
} from '@lixpi/constants'
import {
    createFilledDocument,
    type DocumentKindDefinition,
    type DocumentKindRegistry,
    type SchemaBundle,
} from '@lixpi/prosemirror/shared/document-kind'

export type CapabilityArtifactModelInput = {
    text: string
    referencedAssetIds: string[]
}

export type CapabilityArtifactSourceReference = {
    assetId: string
    role: 'content' | 'media' | 'artifact'
    renditionId?: string
    blobHash?: string
    documentVersion?: number
}

export type CapabilityArtifactSharedDefinition = {
    artifactTypeId: string
    displayName: string
    schemaVersion: string
    allowedEmbeddedReferenceTypes: PromptReferenceType[]
    // The artifact's ProseMirror document kind, registered by every
    // composition root that reads or edits the artifact.
    documentKind: DocumentKindDefinition
    assertInitialDocument: (doc: object) => void
    assertEditableMutation: (
        previousDoc: object,
        proposedDoc: object,
    ) => void
    collectReferencedAssetIds: (doc: object) => string[]
    collectSourceReferences?: (doc: object) => CapabilityArtifactSourceReference[]
    collectOperationKeys?: (doc: object) => string[]
    serializeForModel: (
        doc: object,
        labels: ReadonlyMap<string, string>,
    ) => CapabilityArtifactModelInput
    buildCatalogMetadata: (doc: object) => Record<string, CapabilityJsonValue>
}

export const capabilityArtifactKindId = (artifactTypeId: string): string => `capabilityArtifact:${artifactTypeId}`

// Builds an artifact's document kind. The artifact's own JSON assertions
// become the kind's rules, so the registry enforces them on every parse.
export const defineCapabilityArtifactDocumentKind = ({
    artifactTypeId,
    schemaVersion,
    bundles,
    topNode,
    assertInitialDocument,
    assertEditableMutation,
}: {
    artifactTypeId: string
    schemaVersion: string
    bundles: SchemaBundle[]
    topNode: DocumentKindDefinition['topNode']
    assertInitialDocument: (doc: object) => void
    assertEditableMutation: (
        previousDoc: object,
        proposedDoc: object,
    ) => void
}): DocumentKindDefinition => ({
    id: capabilityArtifactKindId(artifactTypeId),
    schemaVersion,
    bundles,
    topNode,
    createEmptyDocument: createFilledDocument,
    assertInitialDocument: doc => assertInitialDocument(
        doc.toJSON(),
    ),
    assertEditableMutation: (previous, proposed) => assertEditableMutation(
        previous.toJSON(),
        proposed.toJSON(),
    ),
})

// Registers the document kind of every listed artifact definition.
export const registerCapabilityArtifactDocumentKinds = (
    definitions: Array<Pick<CapabilityArtifactSharedDefinition, 'documentKind'>>,
    registry: DocumentKindRegistry,
): void => {
    for (const definition of definitions) {
        if (!registry.has(definition.documentKind.id))
            registry.register(definition.documentKind)
    }
}

export class CapabilityArtifactSharedRegistry {
    private readonly definitions = new Map<string, CapabilityArtifactSharedDefinition>()

    register(definition: CapabilityArtifactSharedDefinition): void {
        assertCompleteSharedDefinition(definition)

        if (this.definitions.has(definition.artifactTypeId))
            throw new Error(`CAPABILITY_ARTIFACT_ALREADY_REGISTERED:${definition.artifactTypeId}`)

        this.definitions.set(
            definition.artifactTypeId,
            Object.freeze({
                ...definition,
                allowedEmbeddedReferenceTypes: Object.freeze([...definition.allowedEmbeddedReferenceTypes]),
            }),
        )
    }

    get(artifactTypeId: string): CapabilityArtifactSharedDefinition | undefined {
        return this.definitions.get(artifactTypeId)
    }

    require(artifactTypeId: string): CapabilityArtifactSharedDefinition {
        const definition = this.get(artifactTypeId)

        if (!definition)
            throw new Error(`CAPABILITY_ARTIFACT_UNKNOWN:${artifactTypeId}`)

        return definition
    }

    list(): CapabilityArtifactSharedDefinition[] {
        return [...this.definitions.values()]
    }
}

export const assertCompleteSharedDefinition = (definition: CapabilityArtifactSharedDefinition): void => {
    if (!definition.artifactTypeId.trim())
        throw new Error('CAPABILITY_ARTIFACT_TYPE_ID_REQUIRED')

    if (!definition.displayName.trim())
        throw new Error(`CAPABILITY_ARTIFACT_DISPLAY_NAME_REQUIRED:${definition.artifactTypeId}`)

    if (!definition.schemaVersion.trim())
        throw new Error(`CAPABILITY_ARTIFACT_SCHEMA_VERSION_REQUIRED:${definition.artifactTypeId}`)

    if (definition.documentKind?.id !== capabilityArtifactKindId(definition.artifactTypeId))
        throw new Error(`CAPABILITY_ARTIFACT_DOCUMENT_KIND_INVALID:${definition.artifactTypeId}`)

    if (new Set(definition.allowedEmbeddedReferenceTypes).size !== definition.allowedEmbeddedReferenceTypes.length)
        throw new Error(`CAPABILITY_ARTIFACT_DUPLICATE_REFERENCE_TYPE:${definition.artifactTypeId}`)
}

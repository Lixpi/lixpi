import {
    type CapabilityJsonValue,
    type PromptReferenceType,
} from '@lixpi/constants'
import {
    type Schema,
} from 'prosemirror-model'

export type CapabilityArtifactModelInput = {
    text: string
    referencedAssetIds: string[]
}

export type CapabilityArtifactSharedDefinition = {
    artifactTypeId: string
    displayName: string
    schemaVersion: string
    allowedEmbeddedReferenceTypes: PromptReferenceType[]
    createDocumentSchema: () => Schema
    assertInitialDocument: (doc: object) => void
    assertEditableMutation: (
        previousDoc: object,
        proposedDoc: object,
    ) => void
    collectReferencedAssetIds: (doc: object) => string[]
    serializeForModel: (
        doc: object,
        labels: ReadonlyMap<string, string>,
    ) => CapabilityArtifactModelInput
    buildCatalogMetadata: (doc: object) => Record<string, CapabilityJsonValue>
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

export function assertCompleteSharedDefinition(definition: CapabilityArtifactSharedDefinition): void {
    if (!definition.artifactTypeId.trim())
        throw new Error('CAPABILITY_ARTIFACT_TYPE_ID_REQUIRED')

    if (!definition.displayName.trim())
        throw new Error(`CAPABILITY_ARTIFACT_DISPLAY_NAME_REQUIRED:${definition.artifactTypeId}`)

    if (!definition.schemaVersion.trim())
        throw new Error(`CAPABILITY_ARTIFACT_SCHEMA_VERSION_REQUIRED:${definition.artifactTypeId}`)

    if (new Set(definition.allowedEmbeddedReferenceTypes).size !== definition.allowedEmbeddedReferenceTypes.length)
        throw new Error(`CAPABILITY_ARTIFACT_DUPLICATE_REFERENCE_TYPE:${definition.artifactTypeId}`)
}

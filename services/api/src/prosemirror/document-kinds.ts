import {
    type Asset,
    type AssetDocumentRole,
} from '@lixpi/constants'
import {
    createCoreDocumentKindRegistry,
    DOCUMENT_TYPE,
    type DocumentKindRegistry,
} from '@lixpi/prosemirror'
import {
    capabilityArtifactKindId,
    registerCapabilityArtifactDocumentKinds,
} from '@lixpi/capability-system/shared'

import { capabilityArtifactBackendRegistry } from '../capability-system/capability-artifacts.ts'

let registry: DocumentKindRegistry | undefined

// The API's document kinds: the core kinds plus every installed Capability
// Artifact. Schemas are built once, when the registry is first used.
export const apiDocumentKinds = (): DocumentKindRegistry => {
    if (!registry) {
        registry = createCoreDocumentKindRegistry()
        registerCapabilityArtifactDocumentKinds(
            capabilityArtifactBackendRegistry.list().map(definition => definition.shared),
            registry,
        )
    }

    return registry
}

const ROLE_KINDS: Partial<Record<AssetDocumentRole, string>> = {
    content: DOCUMENT_TYPE.ASSET_CONTENT,
    conversation: DOCUMENT_TYPE.ASSET_CONVERSATION,
    provenance: DOCUMENT_TYPE.ASSET_PROVENANCE,
}

// The document kind of one of an Asset's documents. A Capability Artifact
// document's kind comes from its artifact type.
export const documentKindForAsset = (
    asset: Pick<Asset, 'artifact'>,
    role: AssetDocumentRole,
): string => {
    if (role === 'capabilityArtifact') {
        if (!asset.artifact)
            throw new Error('CAPABILITY_ARTIFACT_TYPE_REQUIRED')

        return capabilityArtifactKindId(asset.artifact.artifactTypeId)
    }

    const kindId = ROLE_KINDS[role]

    if (!kindId)
        throw new Error(`Unsupported document role: ${role}`)

    return kindId
}

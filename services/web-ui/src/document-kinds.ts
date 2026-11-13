import { createCoreDocumentKindRegistry } from '@lixpi/prosemirror'
import { registerCapabilityArtifactDocumentKinds } from '@lixpi/capability-system/shared'

import { capabilityArtifactSharedRegistry } from '$src/installed-capabilities.ts'

// The browser's document kinds: the core kinds plus every installed
// Capability Artifact. Every editor schema comes from this registry's cache.
export const webUiDocumentKinds = createCoreDocumentKindRegistry()

registerCapabilityArtifactDocumentKinds(
    capabilityArtifactSharedRegistry.list(),
    webUiDocumentKinds,
)

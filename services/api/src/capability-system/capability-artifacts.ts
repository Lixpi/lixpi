import {
    CapabilityArtifactBackendRegistry,
    mediaPipelineBackendDefinition,
} from '@lixpi/capability-system/backend'

export const capabilityArtifactBackendRegistry = new CapabilityArtifactBackendRegistry()

capabilityArtifactBackendRegistry.register(mediaPipelineBackendDefinition)

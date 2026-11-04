import {
    CapabilityArtifactBackendRegistry,
    mediaPipelineBackendDefinition,
} from '@lixpi/capability-system/backend'
import { mediaSequenceArtifactDefinition } from '@lixpi/capability-system/shared'
import {
    actionTimelineArtifactDefinition,
    actionTimelineSettings,
} from '@lixpi/capability-system'

export const capabilityArtifactBackendRegistry = new CapabilityArtifactBackendRegistry()

capabilityArtifactBackendRegistry.register(mediaPipelineBackendDefinition)
capabilityArtifactBackendRegistry.register({
    artifactTypeId: mediaSequenceArtifactDefinition.artifactTypeId,
    shared: mediaSequenceArtifactDefinition,
    initialCanvasDimensions: {
        width: 520,
        height: 300,
    },
})

capabilityArtifactBackendRegistry.register({
    artifactTypeId: actionTimelineArtifactDefinition.artifactTypeId,
    shared: actionTimelineArtifactDefinition,
    // Node geometry is owned by the capability's own settings file, not by this
    // registration, so the capability stays the single place it is tuned.
    initialCanvasDimensions: actionTimelineSettings.canvas.initialDimensions,
})

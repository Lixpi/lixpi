import { CapabilityArtifactBackendRegistry } from '@lixpi/capability-system/backend'
import {
    actionTimelineArtifactDefinition,
    actionTimelineSettings,
} from '@lixpi/capability-system'

export const capabilityArtifactBackendRegistry = new CapabilityArtifactBackendRegistry()

capabilityArtifactBackendRegistry.register({
    artifactTypeId: actionTimelineArtifactDefinition.artifactTypeId,
    shared: actionTimelineArtifactDefinition,
    // Node geometry is owned by the capability's own settings file, not by this
    // registration, so the capability stays the single place it is tuned.
    initialCanvasDimensions: actionTimelineSettings.canvas.initialDimensions,
})

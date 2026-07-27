'use strict'

import {
    CapabilityArtifactBackendRegistry,
} from '@lixpi/capability-system/backend'
import {
    actionTimelineArtifactDefinition,
} from '@lixpi/capability-system'

export const capabilityArtifactBackendRegistry = new CapabilityArtifactBackendRegistry()

capabilityArtifactBackendRegistry.register({
    artifactTypeId: actionTimelineArtifactDefinition.artifactTypeId,
    shared: actionTimelineArtifactDefinition,
    initialCanvasDimensions: {
        width: 520,
        height: 360,
    },
})

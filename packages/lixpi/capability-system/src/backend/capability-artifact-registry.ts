'use strict'

import type { CapabilityArtifactSharedDefinition } from '../shared/capability-artifact.ts'

export type CapabilityArtifactBackendDefinition = {
    artifactTypeId: string
    shared: CapabilityArtifactSharedDefinition
    initialCanvasDimensions: {
        width: number
        height: number
    }
}

export class CapabilityArtifactBackendRegistry {
    private readonly definitions = new Map<string, CapabilityArtifactBackendDefinition>()

    register(definition: CapabilityArtifactBackendDefinition): void {
        if (definition.artifactTypeId !== definition.shared.artifactTypeId) {
            throw new Error(`CAPABILITY_ARTIFACT_BACKEND_ID_MISMATCH:${definition.artifactTypeId}`)
        }
        if (
            !Number.isFinite(definition.initialCanvasDimensions.width)
            || definition.initialCanvasDimensions.width <= 0
            || !Number.isFinite(definition.initialCanvasDimensions.height)
            || definition.initialCanvasDimensions.height <= 0
        ) {
            throw new Error(`CAPABILITY_ARTIFACT_BACKEND_DIMENSIONS_INVALID:${definition.artifactTypeId}`)
        }
        if (this.definitions.has(definition.artifactTypeId)) {
            throw new Error(`CAPABILITY_ARTIFACT_BACKEND_ALREADY_REGISTERED:${definition.artifactTypeId}`)
        }
        this.definitions.set(
            definition.artifactTypeId,
            Object.freeze({
                ...definition,
                initialCanvasDimensions: Object.freeze({ ...definition.initialCanvasDimensions }),
            }),
        )
    }

    get(artifactTypeId: string): CapabilityArtifactBackendDefinition | undefined {
        return this.definitions.get(artifactTypeId)
    }

    require(artifactTypeId: string): CapabilityArtifactBackendDefinition {
        const definition = this.get(artifactTypeId)
        if (!definition) throw new Error(`CAPABILITY_ARTIFACT_BACKEND_UNKNOWN:${artifactTypeId}`)
        return definition
    }

    list(): CapabilityArtifactBackendDefinition[] {
        return [...this.definitions.values()]
    }
}

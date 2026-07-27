'use strict'

import type NatsService from '@lixpi/nats-service'
import {
    CapabilityModuleCatalog,
    createActionTimelineModule,
    createCharacterCreatorModule,
    createStyleExtractionModule,
} from '@lixpi/capability-system/backend'

import type { MetricsClient } from './metrics/metrics-client.ts'
import type { ImageRouter } from './llm/tools/image-router.ts'
import {
    seedBuiltInCapability,
    storeCapabilityResource,
} from './models/capability.ts'
import {
    createCapabilityStructuredModelPort,
    resolveCapabilityModelInputs,
} from './capability-system/capability-model-input-adapter.ts'
import { persistActionTimelineArtifact } from './capability-system/action-timeline-persistence-adapter.ts'
import { createCharacterCreatorActionDependencies } from './capability-system/character-creator-runtime-adapter.ts'
import { createStyleExtractionRuntimePort } from './capability-system/style-extraction-runtime/style-extraction-actions.ts'

export type InstalledCapabilityDependencies = {
    natsService: NatsService
    imageRouter: ImageRouter
    metrics?: MetricsClient
}

export function createDefaultCapabilityModuleCatalog(
    dependencies: InstalledCapabilityDependencies,
): CapabilityModuleCatalog {
    const catalog = new CapabilityModuleCatalog()
    const capabilityStorage = {
        storeResource: storeCapabilityResource,
        seedBuiltInCapability,
    }
    catalog.registerModule(createCharacterCreatorModule({
        ...createCharacterCreatorActionDependencies({
            natsService: dependencies.natsService,
            imageRouter: dependencies.imageRouter,
            metrics: dependencies.metrics,
        }),
        capabilityStorage,
    }))
    catalog.registerModule(createStyleExtractionModule({
        runtime: createStyleExtractionRuntimePort({
            runImageRouter: state => dependencies.imageRouter.execute(state),
        }),
        capabilityStorage,
    }))
    catalog.registerModule(createActionTimelineModule({
        resolveModelInputs: resolveCapabilityModelInputs,
        model: createCapabilityStructuredModelPort(),
        persistArtifact: persistActionTimelineArtifact,
        capabilityStorage,
    }))
    return catalog
}

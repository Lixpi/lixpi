'use strict'

import type NatsService from '@lixpi/nats-service'
import { CapabilityModuleCatalog } from '@lixpi/capability-system/backend'

import type { MetricsClient } from './metrics/metrics-client.ts'
import type { ImageRouter } from './llm/tools/image-router.ts'
import {
    createCharacterCreatorActionDependencies,
    createCharacterCreatorModule,
} from './capability-modules/character-creator/index.ts'
import {
    createStyleExtractionModule,
} from './capability-modules/style-extraction/index.ts'

export type InstalledCapabilityDependencies = {
    natsService: NatsService
    imageRouter: ImageRouter
    metrics?: MetricsClient
}

export function createDefaultCapabilityModuleCatalog(
    dependencies: InstalledCapabilityDependencies,
): CapabilityModuleCatalog {
    const catalog = new CapabilityModuleCatalog()
    catalog.registerModule(createCharacterCreatorModule(
        createCharacterCreatorActionDependencies({
            natsService: dependencies.natsService,
            imageRouter: dependencies.imageRouter,
            metrics: dependencies.metrics,
        }),
    ))
    catalog.registerModule(createStyleExtractionModule({
        runImageRouter: state => dependencies.imageRouter.execute(state),
    }))
    return catalog
}

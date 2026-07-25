'use strict'

import type NatsService from '@lixpi/nats-service'
import { CapabilityModuleCatalog } from '@lixpi/capability-system/backend'

import type { MetricsClient } from './metrics/metrics-client.ts'
import type { ImageRouter } from './llm/tools/image-router.ts'
import {
    createCharacterCreatorActionDependencies,
    createCharacterCreatorSkillModules,
    createCharacterCreatorToolModule,
} from './capability-modules/character-creator/index.ts'
import {
    createStyleExtractionSkillModules,
    createStyleExtractionToolModule,
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
    for (const skill of createCharacterCreatorSkillModules()) catalog.registerSkill(skill)
    for (const skill of createStyleExtractionSkillModules()) catalog.registerSkill(skill)
    catalog.registerTool(createCharacterCreatorToolModule(
        createCharacterCreatorActionDependencies({
            natsService: dependencies.natsService,
            imageRouter: dependencies.imageRouter,
            metrics: dependencies.metrics,
        }),
    ))
    catalog.registerTool(createStyleExtractionToolModule({
        runImageRouter: state => dependencies.imageRouter.execute(state),
    }))
    return catalog
}

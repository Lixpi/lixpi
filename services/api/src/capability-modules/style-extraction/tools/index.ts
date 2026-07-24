'use strict'

import type {
    CapabilityActionRegistry,
    CapabilityModuleSeedContext,
    ToolModule,
} from '@lixpi/capability-system/backend'
import {
    registerStyleExtractionActions,
    type StyleExtractionActionDependencies,
} from './style-extraction-actions.ts'
import { seedStyleExtractionTool } from './style-extraction-definition.ts'

export function createStyleExtractionToolModule(
    dependencies: StyleExtractionActionDependencies,
): ToolModule {
    return {
        kind: 'tool',
        moduleId: 'style-extraction',
        registerActions: (registry: CapabilityActionRegistry): void => {
            registerStyleExtractionActions(registry, dependencies)
        },
        seed: async (context: CapabilityModuleSeedContext): Promise<void> => {
            await seedStyleExtractionTool(context.allowedActions)
        },
    }
}

export * from './style-extraction-actions.ts'
export * from './style-extraction-definition.ts'
export * from './style-extraction-input-resolver.ts'

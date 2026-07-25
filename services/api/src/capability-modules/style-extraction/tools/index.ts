'use strict'

import type {
    CapabilityActionRegistry,
    CapabilityPackageSeedContext,
    CapabilityToolPackageInstaller,
} from '@lixpi/capability-system/backend'
import {
    registerStyleExtractionActions,
    type StyleExtractionActionDependencies,
} from './style-extraction-actions.ts'
import {
    seedStyleExtractionTool,
    STYLE_EXTRACTION_CAPABILITY_IDS,
} from './style-extraction-definition.ts'

export function createStyleExtractionToolPackage(
    dependencies: StyleExtractionActionDependencies,
): CapabilityToolPackageInstaller {
    return {
        kind: 'tool',
        capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool,
        registerActions: (registry: CapabilityActionRegistry): void => {
            registerStyleExtractionActions(registry, dependencies)
        },
        seed: async (context: CapabilityPackageSeedContext): Promise<void> => {
            await seedStyleExtractionTool(context)
        },
    }
}

export * from './style-extraction-actions.ts'
export * from './style-extraction-definition.ts'
export * from './style-extraction-input-resolver.ts'

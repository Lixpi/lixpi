import {
    type CapabilityActionRegistry,
    type CapabilityPackageSeedContext,
    type CapabilityToolPackageInstaller,
} from '../../../backend/index.ts'
import {
    seedStyleExtractionTool,
    STYLE_EXTRACTION_CAPABILITY_IDS,
    type StyleExtractionCapabilityStorage,
} from './style-extraction-definition.ts'
import {
    registerStyleExtractionActions,
    type StyleExtractionActionDependencies,
} from './style-extraction-actions.ts'

export const createStyleExtractionToolPackage = (
    dependencies: StyleExtractionActionDependencies,
    storage: StyleExtractionCapabilityStorage,
): CapabilityToolPackageInstaller => {
    return {
        kind: 'tool',
        capabilityId: STYLE_EXTRACTION_CAPABILITY_IDS.tool,
        registerActions: (registry: CapabilityActionRegistry): void => void registerStyleExtractionActions(registry, dependencies),
        seed: async (context: CapabilityPackageSeedContext): Promise<void> => void (await seedStyleExtractionTool(context, storage)),
    }
}

export * from './style-extraction-actions.ts'
export * from './style-extraction-definition.ts'

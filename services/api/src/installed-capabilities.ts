import {
    CapabilityModuleCatalog,
    createWorkspaceCanvasModule,
} from '@lixpi/capability-system/backend'

import {
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'
import {
    seedBuiltInCapability,
    storeCapabilityResource,
} from './models/capability.ts'
import { installMediaWorkspace } from './installed-media-workspace.ts'
import { canvasComposerAccess } from './capability-system/canvas-composer-adapter.ts'
import { createCanvasGenerationRecoveryAccess } from './capability-system/canvas-generation-recovery-adapter.ts'
import { canvasHandoffAccess } from './capability-system/canvas-handoff-adapter.ts'
import { canvasAgentAccess } from './capability-system/canvas-agent-adapter.ts'
import { createCanvasExtendedAccess } from './services/canvas-extended-agent-adapter.ts'

export type InstalledCapabilityDependencies = {
    providerUsage?: ProviderUsageClient
}

export const createDefaultCapabilityModuleCatalog = (dependencies: InstalledCapabilityDependencies): CapabilityModuleCatalog => {
    const catalog = new CapabilityModuleCatalog()
    const capabilityStorage = {
        storeResource: storeCapabilityResource,
        seedBuiltInCapability,
    }

    const regeneratePipeline = installMediaWorkspace(
        catalog,
        capabilityStorage,
        dependencies.providerUsage,
    )

    catalog.registerModule(
        createWorkspaceCanvasModule(
            canvasAgentAccess,
            capabilityStorage,
            createCanvasExtendedAccess(),
            canvasHandoffAccess,
            canvasComposerAccess,
            createCanvasGenerationRecoveryAccess(regeneratePipeline),
        ),
    )

    return catalog
}

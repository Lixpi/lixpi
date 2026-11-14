import { CapabilityModuleCatalog } from '@lixpi/capability-system/backend'

import {
    type ProviderUsageClient,
} from '@lixpi/usage-reporter'
import {
    seedBuiltInCapability,
    storeCapabilityResource,
} from './models/capability.ts'
import { installMediaWorkspace } from './installed-media-workspace.ts'

export type InstalledCapabilityDependencies = {
    providerUsage?: ProviderUsageClient
}

export const createDefaultCapabilityModuleCatalog = (dependencies: InstalledCapabilityDependencies): CapabilityModuleCatalog => {
    const catalog = new CapabilityModuleCatalog()
    const capabilityStorage = {
        storeResource: storeCapabilityResource,
        seedBuiltInCapability,
    }

    installMediaWorkspace(
        catalog,
        capabilityStorage,
        dependencies.providerUsage,
    )

    return catalog
}

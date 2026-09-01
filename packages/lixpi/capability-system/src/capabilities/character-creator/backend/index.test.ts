import {
    describe,
    expect,
    it,
} from 'vitest'

import { CapabilityMediaStrategyRegistry } from '../../../backend/capability-media-strategy-registry.ts'
import { CapabilityModuleCatalog } from '../../../backend/capability-module.ts'
import {
    type CapabilityMediaExecutionPlan,
} from '../../../shared/capability-media-execution-plan.ts'
import { createCharacterCreatorModule } from './index.ts'
import {
    type CharacterCreatorRuntimePorts,
} from './runtime/runtime-ports.ts'

const unavailable = async (): Promise<never> => {
    throw new Error('Platform port should not execute during module installation')
}

const runtime: CharacterCreatorRuntimePorts = {
    referenceAssets: {
        getAuthorizedAsset: unavailable,
        readBlob: unavailable,
    },
    transientMedia: {
        create: () => ({
            putWithCoordinate: unavailable,
            clear: async () => undefined,
        }),
    },
    imageGeneration: { generate: unavailable },
    structuredVlm: { call: unavailable },
    fidelity: { assess: unavailable },
}

describe('createCharacterCreatorModule', () => {
    it('publishes its media runtime through the generic module installation hook', () => {
        const module = createCharacterCreatorModule({
            capabilityStorage: {
                storeResource: unavailable,
                seedBuiltInCapability: unavailable,
            },
            runtime,
        })
        const catalog = new CapabilityModuleCatalog()
        const registry = new CapabilityMediaStrategyRegistry()
        catalog.registerModule(module)

        catalog.registerMediaStrategies(registry)

        expect(module.mediaStrategies?.map(strategy => strategy.kind)).toEqual(['character-sheet'])
        expect(registry.get(
            {
                kind: 'character-sheet',
                capabilityRunId: 'run-1',
            } satisfies CapabilityMediaExecutionPlan,
        )).toBe(module.mediaStrategies?.[0])
    })
})

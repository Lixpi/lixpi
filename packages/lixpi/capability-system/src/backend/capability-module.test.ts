import { describe, expect, it } from 'vitest'

import { CapabilityActionRegistry } from './capability-action-registry.ts'
import {
    CapabilityModuleCatalog,
    type CapabilityModuleDefinition,
    type CapabilitySkillPackageInstaller,
    type CapabilityToolPackageInstaller,
} from './capability-module.ts'

const makeSkill = (capabilityId: string, calls: string[]): CapabilitySkillPackageInstaller => ({
    kind: 'skill',
    capabilityId,
    seed: async context => {
        calls.push(`seed:${capabilityId}:${context.parentModuleId}:${context.catalogExposure}`)
    },
})

const makeTool = (capabilityId: string, calls: string[]): CapabilityToolPackageInstaller => ({
    kind: 'tool',
    capabilityId,
    registerActions: () => { calls.push(`register:${capabilityId}`) },
    seed: async context => {
        calls.push(`seed:${capabilityId}:${context.parentModuleId}:${context.catalogExposure}`)
    },
})

const makeModule = (
    moduleId: string,
    calls: string[],
    entry = `global.${moduleId}`,
): CapabilityModuleDefinition => ({
    moduleId,
    name: moduleId === 'character-creator' ? 'Character Creator' : 'Style Extraction',
    normalizedName: moduleId.replace('-', ' '),
    summary: `${moduleId} summary`,
    tags: [moduleId.split('-')[0]!],
    entry: { capabilityId: entry, kind: 'tool' },
    tools: [makeTool(entry, calls)],
    skills: [makeSkill(`${entry}.instructions`, calls)],
})

describe('CapabilityModuleCatalog', () => {
    it('registers one top-level module and seeds every contained package as internal', async () => {
        const calls: string[] = []
        const actionRegistry = new CapabilityActionRegistry()
        const catalog = new CapabilityModuleCatalog()
        catalog.registerModule(makeModule('character-creator', calls))

        catalog.registerActions(actionRegistry)
        await catalog.seedAll(actionRegistry)

        expect(catalog.listModuleIds()).toEqual(['character-creator'])
        expect(catalog.resolveEntry('character-creator')).toEqual({
            capabilityId: 'global.character-creator',
            kind: 'tool',
        })
        expect(calls).toEqual([
            'register:global.character-creator',
            'seed:global.character-creator.instructions:character-creator:module-internal',
            'seed:global.character-creator:character-creator:module-internal',
        ])
    })

    it('rejects duplicate module IDs and package ownership across modules', () => {
        const catalog = new CapabilityModuleCatalog()
        catalog.registerModule(makeModule('character-creator', []))

        expect(() => catalog.registerModule(makeModule('character-creator', [])))
            .toThrow('CAPABILITY_MODULE_ALREADY_REGISTERED:character-creator')
        expect(() => catalog.registerModule(makeModule('style-extraction', [], 'global.character-creator')))
            .toThrow('CAPABILITY_PACKAGE_ALREADY_OWNED:global.character-creator:character-creator')
    })

    it('rejects missing and kind-mismatched entry packages', () => {
        const catalog = new CapabilityModuleCatalog()
        const missing = makeModule('character-creator', [], 'global.missing')
        missing.tools = [makeTool('global.other', [])]
        expect(() => catalog.registerModule(missing))
            .toThrow('CAPABILITY_MODULE_ENTRY_NOT_OWNED:character-creator:global.missing')

        const wrongKind = makeModule('style-extraction', [])
        wrongKind.entry = { ...wrongKind.entry, kind: 'skill' }
        expect(() => catalog.registerModule(wrongKind))
            .toThrow('CAPABILITY_MODULE_ENTRY_KIND_MISMATCH:style-extraction:global.style-extraction')
    })

    it('searches only module metadata by normalized name or tag', () => {
        const catalog = new CapabilityModuleCatalog()
        catalog.registerModule(makeModule('character-creator', []))
        catalog.registerModule(makeModule('style-extraction', []))

        expect(catalog.listModules('char').map(module => module.moduleId)).toEqual(['character-creator'])
        expect(catalog.listModules('style').map(module => module.moduleId)).toEqual(['style-extraction'])
        expect(catalog.getModuleMeta('character-creator')).toEqual(expect.objectContaining({
            name: 'Character Creator',
            status: 'active',
        }))
    })
})

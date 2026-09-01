'use strict'

import {
    describe,
    expect,
    it,
} from 'vitest'

import type { CapabilityMediaExecutionPlan } from '../shared/capability-media-execution-plan.ts'

import { CapabilityActionRegistry } from './capability-action-registry.ts'
import { CapabilityMediaStrategyRegistry } from './capability-media-strategy-registry.ts'
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
    registerActions: () => {
        calls.push(`register:${capabilityId}`)
    },
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
    descriptionSheet: {
        purpose: `Creates ${moduleId} output.`,
        expectedInputs: [{
            name: 'Prompt',
            requirement: 'required',
            accepts: ['prompt'],
            description: 'Describe the requested output.',
        }],
        bestResults: ['Use a concrete prompt.'],
        limitations: ['Output quality depends on the selected model.'],
        executionCharacteristics: {
            cost: 'low',
            latency: 'low',
            summary: 'Runs one local workflow.',
        },
    },
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
        expect(catalog.getModuleMeta('character-creator')?.descriptionSheet.purpose)
            .toBe('Creates character-creator output.')
        expect(calls).toEqual([
            'register:global.character-creator',
            'seed:global.character-creator.instructions:character-creator:module-internal',
            'seed:global.character-creator:character-creator:module-internal',
        ])
    })

    it('installs module-owned media strategies into the host registry', () => {
        const strategy = {
            kind: 'character-sheet' as const,
            execute: async () => ({ generatedImages: ['sheet'] }),
        }
        const definition = makeModule('character-creator', [])
        definition.mediaStrategies = [strategy]
        const catalog = new CapabilityModuleCatalog()
        const registry = new CapabilityMediaStrategyRegistry()
        catalog.registerModule(definition)

        catalog.registerMediaStrategies(registry)

        expect(registry.get({ kind: 'character-sheet' } as CapabilityMediaExecutionPlan)).toBe(strategy)
    })

    it.each(
        [
            ['missing sheet', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: undefined }), 'CAPABILITY_MODULE_DESCRIPTION_SHEET_REQUIRED'],
            ['empty purpose', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, purpose: ' ' } }), 'CAPABILITY_MODULE_DESCRIPTION_PURPOSE_REQUIRED'],
            ['missing inputs', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, expectedInputs: [] } }), 'CAPABILITY_MODULE_DESCRIPTION_EXPECTED_INPUTS_REQUIRED'],
            ['duplicate input names', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, expectedInputs: [definition.descriptionSheet.expectedInputs[0]!, { ...definition.descriptionSheet.expectedInputs[0]!, name: ' prompt ' }] } }), 'CAPABILITY_MODULE_DESCRIPTION_INPUT_NAME_DUPLICATE'],
            ['invalid input requirement', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, expectedInputs: [{ ...definition.descriptionSheet.expectedInputs[0]!, requirement: 'sometimes' }] } }), 'CAPABILITY_MODULE_DESCRIPTION_INPUT_REQUIREMENT_INVALID'],
            ['empty accepted kinds', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, expectedInputs: [{ ...definition.descriptionSheet.expectedInputs[0]!, accepts: [] }] } }), 'CAPABILITY_MODULE_DESCRIPTION_INPUT_ACCEPTS_INVALID'],
            ['missing best results', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, bestResults: [] } }), 'CAPABILITY_MODULE_DESCRIPTION_BEST_RESULTS_REQUIRED'],
            ['missing limitations', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, limitations: [] } }), 'CAPABILITY_MODULE_DESCRIPTION_LIMITATIONS_REQUIRED'],
            ['invalid cost', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, executionCharacteristics: { ...definition.descriptionSheet.executionCharacteristics, cost: 'extreme' } } }), 'CAPABILITY_MODULE_DESCRIPTION_EXECUTION_COST_INVALID'],
            ['invalid latency', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, executionCharacteristics: { ...definition.descriptionSheet.executionCharacteristics, latency: 'instant' } } }), 'CAPABILITY_MODULE_DESCRIPTION_EXECUTION_LATENCY_INVALID'],
            ['raw HTML', (definition: CapabilityModuleDefinition) => ({ ...definition, descriptionSheet: { ...definition.descriptionSheet, purpose: '<strong>Unsafe</strong>' } }), 'CAPABILITY_MODULE_DESCRIPTION_PURPOSE_HTML_FORBIDDEN'],
        ] as const,
    )('rejects description sheets with %s', (_name, mutate, errorCode) => {
        const definition = mutate(makeModule('character-creator', [])) as CapabilityModuleDefinition
        expect(() => new CapabilityModuleCatalog().registerModule(definition)).toThrow(errorCode)
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

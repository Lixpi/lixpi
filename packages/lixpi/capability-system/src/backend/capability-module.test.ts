import { describe, expect, it, vi } from 'vitest'

import { CapabilityActionRegistry } from './capability-action-registry.ts'
import {
    CapabilityModuleCatalog,
    type SkillModule,
    type ToolModule,
} from './capability-module.ts'

function makeSkill(moduleId: string, calls: string[]): SkillModule {
    return {
        kind: 'skill',
        moduleId,
        seed: async context => {
            calls.push(`seed-skill:${moduleId}:${[...context.allowedActions].sort().join(',')}`)
        },
    }
}

function makeTool(moduleId: string, calls: string[]): ToolModule {
    return {
        kind: 'tool',
        moduleId,
        registerActions: () => { calls.push(`register-tool:${moduleId}`) },
        seed: async context => {
            calls.push(`seed-tool:${moduleId}:${[...context.allowedActions].sort().join(',')}`)
        },
    }
}

describe('CapabilityModuleCatalog', () => {
    it('registers Tool actions and seeds Skills before Tools in deterministic order', async () => {
        const calls: string[] = []
        const registry = new CapabilityActionRegistry()
        registry.register({
            key: 'test.action',
            timeoutMs: 1,
            validateInput: () => ({ valid: true }),
            validateOutput: () => ({ valid: true }),
            authorize: () => true,
            execute: vi.fn(async () => ({})),
            classifyRetry: () => 'terminal',
            summarizeInput: () => '',
            summarizeOutput: () => '',
        })
        const catalog = new CapabilityModuleCatalog()
        catalog.registerTool(makeTool('character-creator', calls))
        catalog.registerSkill(makeSkill('character-layout', calls))
        catalog.registerTool(makeTool('style-extraction', calls))
        catalog.registerSkill(makeSkill('style-axes', calls))

        catalog.registerActions(registry)
        await catalog.seedAll(registry)

        expect(catalog.listModuleIds()).toEqual({
            skills: ['character-layout', 'style-axes'],
            tools: ['character-creator', 'style-extraction'],
        })
        expect(calls).toEqual([
            'register-tool:character-creator',
            'register-tool:style-extraction',
            'seed-skill:character-layout:test.action',
            'seed-skill:style-axes:test.action',
            'seed-tool:character-creator:test.action',
            'seed-tool:style-extraction:test.action',
        ])
    })

    it('rejects duplicate module IDs across Tool and Skill kinds', () => {
        const catalog = new CapabilityModuleCatalog()
        catalog.registerSkill(makeSkill('duplicate', []))

        expect(() => catalog.registerTool(makeTool('duplicate', [])))
            .toThrow('CAPABILITY_MODULE_ALREADY_REGISTERED:duplicate')
    })
})

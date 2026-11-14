import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    CapabilityAgentRegistry,
    type CapabilityAgentEntry,
} from './capability-agent-registry.ts'

const tool = (): CapabilityAgentEntry => ({
    kind: 'tool',
    name: 'inspect_sequence',
    description: 'Read the sequence revision.',
    schema: { type: 'object', properties: { sequenceId: { type: 'string' } } },
    intent: 'inspect',
    operationFamilies: [],
    execute: vi.fn(),
    owner: { kind: 'module', moduleId: 'sequence', capabilityId: 'sequence-tool' },
})

const skill = (): CapabilityAgentEntry => ({
    kind: 'skill',
    name: 'sequence-editing',
    description: 'Sequence editing rules.',
    capabilityId: 'sequence-skill',
    bundle: { name: 'sequence-editing', files: { instructions: 'SKILL.md' } },
    owner: { kind: 'module', moduleId: 'sequence', capabilityId: 'sequence-skill' },
})

const expert = (): CapabilityAgentEntry => ({
    kind: 'expert',
    name: 'sequence-expert',
    description: 'Delegate sequence editing.',
    operationFamilies: ['sequence-edit'],
    runtime: {
        kind: 'agent',
        instructions: 'Use the authorized sequence tools and Skill.',
        toolNames: ['inspect_sequence'],
        skillIds: ['sequence-skill'],
    },
    owner: { kind: 'module', moduleId: 'sequence', capabilityId: 'sequence-tool' },
})

// =============================================================================
// UNIFIED REGISTRATION AND AUTHORIZED VIEWS
// =============================================================================

describe('CapabilityAgentRegistry', () => {
    it('rejects collisions across platform tools and module entries', () => {
        expect(() => new CapabilityAgentRegistry([tool(), { ...tool(), owner: { kind: 'platform' } }])).toThrow('CAPABILITY_AGENT_ALREADY_REGISTERED')
    })

    it('rejects experts whose declared execution tools are missing', () => {
        expect(() => new CapabilityAgentRegistry([skill(), expert()])).toThrow('CAPABILITY_EXPERT_TOOL_UNAVAILABLE')
    })

    it('hides an expert after access to a required Skill is removed', () => {
        const registry = new CapabilityAgentRegistry([tool(), skill(), expert()])
        const scoped = registry.scope(entry => entry.kind !== 'skill')
        expect(scoped.tools().map(entry => entry.name)).toEqual(['inspect_sequence'])
        expect(scoped.experts()).toEqual([])
        expect(registry.experts()).toHaveLength(1)
    })

    it('retains an immutable copy of nested registration metadata', () => {
        const registration = expert()
        const registeredTool = tool()
        const registry = new CapabilityAgentRegistry([registeredTool, skill(), registration])

        if (registration.kind !== 'expert' || registration.runtime.kind !== 'agent' || registeredTool.kind !== 'tool')
            throw new Error('Invalid fixture')

        const toolNames = registration.runtime.toolNames as string[]
        toolNames.push('unexpected_tool')
        registeredTool.schema.type = 'array'
        const saved = registry.get('sequence-expert')
        expect(saved?.kind === 'expert' && saved.runtime.kind === 'agent' ? saved.runtime.toolNames : []).toEqual(['inspect_sequence'])
        expect(Object.isFrozen(saved)).toBe(true)
        expect(registry.tools()[0].schema.type).toBe('object')
    })
})

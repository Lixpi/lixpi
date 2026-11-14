import {
    type CapabilityAgentTool,
    type CapabilitySkillPackageInstaller,
} from './capability-module.ts'

export type CapabilityAgentExpert = {
    kind: 'expert'
    name: string
    description: string
    operationFamilies: readonly string[]
    runtime:
        | {
            kind: 'agent'
            instructions: string
            toolNames: readonly string[]
            skillIds: readonly string[]
        }
        | {
            kind: 'workflow'
            capabilityId: string
            schema: Record<string, unknown>
            execution: 'capability' | 'media'
        }
}

export type CapabilityAgentSkill = {
    kind: 'skill'
    name: string
    description: string
    capabilityId: string
    bundle: NonNullable<CapabilitySkillPackageInstaller['agentSkill']>
}

export type CapabilityAgentRegistration =
    | (CapabilityAgentTool & { kind: 'tool' })
    | (Omit<CapabilityAgentTool, 'execute'> & {
        kind: 'tool'
        native: true
    })
    | CapabilityAgentSkill
    | CapabilityAgentExpert

export type CapabilityAgentEntry = CapabilityAgentRegistration & {
    owner:
        | { kind: 'platform' }
        | {
            kind: 'module'
            moduleId: string
            capabilityId: string
        }
}

// One view owns every model-visible registration for an invocation. Platform
// callbacks belong to this view, never to the application-wide module catalog.
export class CapabilityAgentRegistry {
    private readonly entries = new Map<string, CapabilityAgentEntry>()

    constructor(entries: readonly CapabilityAgentEntry[]) {
        for (const entry of entries) {
            if (!entry.name.trim())
                throw new Error('CAPABILITY_AGENT_NAME_REQUIRED')

            if (
                entry.kind === 'tool'
                && entry.permission === 'private-state'
                && (entry.owner.kind !== 'platform' || !('native' in entry) || entry.native !== true || 'execute' in entry || !['write_file', 'edit_file', 'write_todos'].includes(entry.name))
            )
                throw new Error(`CAPABILITY_AGENT_PRIVATE_STATE_INVALID:${entry.name}`)

            if (this.entries.has(entry.name))
                throw new Error(`CAPABILITY_AGENT_ALREADY_REGISTERED:${entry.name}`)

            this.entries.set(
                entry.name,
                freezeEntry(entry),
            )
        }

        for (const entry of this.entries.values()) {
            if (
                entry.kind !== 'expert'
                || entry.runtime.kind !== 'agent'
            )
                continue

            for (const name of entry.runtime.toolNames)
                if (this.entries.get(name)?.kind !== 'tool')
                    throw new Error(`CAPABILITY_EXPERT_TOOL_UNAVAILABLE:${entry.name}:${name}`)

            for (const id of entry.runtime.skillIds)
                if (!this.list().some(item => item.kind === 'skill' && item.capabilityId === id))
                    throw new Error(`CAPABILITY_EXPERT_SKILL_UNAVAILABLE:${entry.name}:${id}`)
        }
    }

    get(name: string): CapabilityAgentEntry | undefined {
        return this.entries.get(name)
    }

    list(): CapabilityAgentEntry[] {
        return [...this.entries.values()]
    }

    scope(allowed: (entry: CapabilityAgentEntry) => boolean): CapabilityAgentRegistry {
        const entries = this.list().filter(allowed)
        const tools = new Set(
            entries.filter(entry => entry.kind === 'tool').map(entry => entry.name),
        )
        const skills = new Set(
            entries.filter(entry => entry.kind === 'skill').map(entry => entry.capabilityId),
        )

        return new CapabilityAgentRegistry(
            entries.filter(
                entry => entry.kind !== 'expert'
                    || entry.runtime.kind !== 'agent'
                    || (entry.runtime.toolNames.every(name => tools.has(name))
                        && entry.runtime.skillIds.every(id => skills.has(id))),
            ),
        )
    }

    tools(): Array<CapabilityAgentEntry & { kind: 'tool' }> {
        return this.list().filter((entry): entry is CapabilityAgentEntry & { kind: 'tool' } => entry.kind === 'tool')
    }

    skills(): Array<CapabilityAgentEntry & { kind: 'skill' }> {
        return this.list().filter((entry): entry is CapabilityAgentEntry & { kind: 'skill' } => entry.kind === 'skill')
    }

    experts(): Array<CapabilityAgentEntry & { kind: 'expert' }> {
        return this.list().filter((entry): entry is CapabilityAgentEntry & { kind: 'expert' } => entry.kind === 'expert')
    }
}

const freezeValue = <T>(value: T): T => {
    if (
        value
        && typeof value === 'object'
    ) {
        for (const child of Object.values(value))
            freezeValue(child)

        Object.freeze(value)
    }

    return value
}

const freezeEntry = (entry: CapabilityAgentEntry): CapabilityAgentEntry => {
    const owner = { ...entry.owner }

    if (entry.kind === 'tool')
        return freezeValue({
            ...entry,
            owner,
            schema: structuredClone(entry.schema),
            operationFamilies: [...entry.operationFamilies],
        })

    if (entry.kind === 'skill')
        return freezeValue({
            ...entry,
            owner,
            bundle: structuredClone(entry.bundle),
        })

    return freezeValue({
        ...entry,
        owner,
        operationFamilies: [...entry.operationFamilies],
        runtime: structuredClone(entry.runtime),
    })
}

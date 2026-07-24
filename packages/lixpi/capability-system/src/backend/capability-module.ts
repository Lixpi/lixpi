'use strict'

import { CapabilityActionRegistry } from './capability-action-registry.ts'

export type CapabilityModuleSeedContext = {
    allowedActions: ReadonlySet<string>
}

export type SkillModule = {
    kind: 'skill'
    moduleId: string
    seed: (context: CapabilityModuleSeedContext) => Promise<void>
}

export type ToolModule = {
    kind: 'tool'
    moduleId: string
    registerActions: (registry: CapabilityActionRegistry) => void
    seed: (context: CapabilityModuleSeedContext) => Promise<void>
}

export class CapabilityModuleCatalog {
    private readonly skills = new Map<string, SkillModule>()
    private readonly tools = new Map<string, ToolModule>()

    registerSkill(module: SkillModule): void {
        this.assertUnique(module.moduleId)
        this.skills.set(module.moduleId, module)
    }

    registerTool(module: ToolModule): void {
        this.assertUnique(module.moduleId)
        this.tools.set(module.moduleId, module)
    }

    private assertUnique(moduleId: string): void {
        if (this.skills.has(moduleId) || this.tools.has(moduleId)) {
            throw new Error(`CAPABILITY_MODULE_ALREADY_REGISTERED:${moduleId}`)
        }
    }

    registerActions(registry: CapabilityActionRegistry): void {
        for (const module of this.tools.values()) module.registerActions(registry)
    }

    async seedAll(registry: CapabilityActionRegistry): Promise<void> {
        const context: CapabilityModuleSeedContext = {
            allowedActions: registry.allowedActionKeys(),
        }
        for (const module of this.skills.values()) await module.seed(context)
        for (const module of this.tools.values()) await module.seed(context)
    }

    listModuleIds(): { skills: string[]; tools: string[] } {
        return {
            skills: [...this.skills.keys()],
            tools: [...this.tools.keys()],
        }
    }
}

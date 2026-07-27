'use strict'

import type {
    CapabilityJsonValue,
    CapabilityKind,
    CapabilityModuleMeta,
} from '@lixpi/constants'

import { CapabilityActionRegistry } from './capability-action-registry.ts'

export type CapabilityPackageSeedContext = {
    allowedActions: ReadonlySet<string>
    parentModuleId: string
    catalogExposure: 'module-internal'
}

export type CapabilitySkillPackageInstaller = {
    kind: 'skill'
    capabilityId: string
    seed: (context: CapabilityPackageSeedContext) => Promise<void>
}

export type CapabilityToolPackageInstaller = {
    kind: 'tool'
    capabilityId: string
    registerActions: (registry: CapabilityActionRegistry) => void
    seed: (context: CapabilityPackageSeedContext) => Promise<void>
}

export type CapabilityModuleRoute = {
    capabilityId: string
    kind: 'tool'
    input: Record<string, CapabilityJsonValue>
    missingInputFields: string[]
}

export type CapabilityModuleRoutingDefinition = {
    resolve: (prompt: string) => CapabilityModuleRoute | undefined
}

export type CapabilityModuleDefinition = Omit<CapabilityModuleMeta, 'status'> & {
    entry: {
        capabilityId: string
        kind: CapabilityKind
    }
    tools: CapabilityToolPackageInstaller[]
    skills: CapabilitySkillPackageInstaller[]
    routing?: CapabilityModuleRoutingDefinition
}

export class CapabilityModuleCatalog {
    private readonly modules = new Map<string, CapabilityModuleDefinition>()
    private readonly packageOwners = new Map<string, string>()

    registerModule(definition: CapabilityModuleDefinition): void {
        this.validateDefinition(definition)
        if (this.modules.has(definition.moduleId)) {
            throw new Error(`CAPABILITY_MODULE_ALREADY_REGISTERED:${definition.moduleId}`)
        }

        for (const installer of [...definition.tools, ...definition.skills]) {
            const owner = this.packageOwners.get(installer.capabilityId)
            if (owner) {
                throw new Error(`CAPABILITY_PACKAGE_ALREADY_OWNED:${installer.capabilityId}:${owner}`)
            }
        }

        this.modules.set(definition.moduleId, definition)
        for (const installer of [...definition.tools, ...definition.skills]) {
            this.packageOwners.set(installer.capabilityId, definition.moduleId)
        }
    }

    registerActions(registry: CapabilityActionRegistry): void {
        for (const definition of this.modules.values()) {
            for (const installer of definition.tools) installer.registerActions(registry)
        }
    }

    async seedAll(registry: CapabilityActionRegistry): Promise<void> {
        for (const definition of this.modules.values()) {
            const context: CapabilityPackageSeedContext = {
                allowedActions: registry.allowedActionKeys(),
                parentModuleId: definition.moduleId,
                catalogExposure: 'module-internal',
            }
            for (const installer of definition.skills) await installer.seed(context)
            for (const installer of definition.tools) await installer.seed(context)
        }
    }

    getModule(moduleId: string): CapabilityModuleDefinition | undefined {
        return this.modules.get(moduleId)
    }

    getModuleMeta(moduleId: string): CapabilityModuleMeta | undefined {
        const definition = this.modules.get(moduleId)
        return definition ? this.toMeta(definition) : undefined
    }

    listModules(query = ''): CapabilityModuleMeta[] {
        const normalizedQuery = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
        return [...this.modules.values()]
            .filter((definition) => !normalizedQuery
                || definition.normalizedName.startsWith(normalizedQuery)
                || definition.tags.some((tag) => tag.startsWith(normalizedQuery)))
            .map((definition) => this.toMeta(definition))
            .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName)
                || left.moduleId.localeCompare(right.moduleId))
    }

    listModuleIds(): string[] {
        return [...this.modules.keys()]
    }

    resolveEntry(moduleId: string): { capabilityId: string; kind: CapabilityKind } | undefined {
        const definition = this.modules.get(moduleId)
        return definition ? { ...definition.entry } : undefined
    }

    routePrompt(prompt: string): CapabilityModuleRoute | undefined {
        const matches = [...this.modules.values()].flatMap(definition => {
            const route = definition.routing?.resolve(prompt)
            return route ? [route] : []
        })
        if (matches.length > 1) throw new Error('CAPABILITY_MODULE_ROUTE_AMBIGUOUS')
        return matches[0]
    }

    private validateDefinition(definition: CapabilityModuleDefinition): void {
        if (!definition.moduleId.trim()) throw new Error('CAPABILITY_MODULE_ID_REQUIRED')
        if (!definition.name.trim()) throw new Error(`CAPABILITY_MODULE_NAME_REQUIRED:${definition.moduleId}`)
        if (definition.normalizedName !== definition.name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')) {
            throw new Error(`CAPABILITY_MODULE_NORMALIZED_NAME_INVALID:${definition.moduleId}`)
        }

        const packages = [...definition.tools, ...definition.skills]
        const localIds = new Set<string>()
        for (const installer of packages) {
            if (localIds.has(installer.capabilityId)) {
                throw new Error(`CAPABILITY_MODULE_DUPLICATE_PACKAGE:${definition.moduleId}:${installer.capabilityId}`)
            }
            localIds.add(installer.capabilityId)
        }

        const entryMatches = packages.filter((installer) => installer.capabilityId === definition.entry.capabilityId)
        if (entryMatches.length !== 1) {
            throw new Error(`CAPABILITY_MODULE_ENTRY_NOT_OWNED:${definition.moduleId}:${definition.entry.capabilityId}`)
        }
        if (entryMatches[0]!.kind !== definition.entry.kind) {
            throw new Error(`CAPABILITY_MODULE_ENTRY_KIND_MISMATCH:${definition.moduleId}:${definition.entry.capabilityId}`)
        }
    }

    private toMeta(definition: CapabilityModuleDefinition): CapabilityModuleMeta {
        return {
            moduleId: definition.moduleId,
            name: definition.name,
            normalizedName: definition.normalizedName,
            summary: definition.summary,
            tags: [...definition.tags],
            status: 'active',
        }
    }
}

'use strict'

import type {
    CapabilityExpectedInput,
    CapabilityJsonValue,
    CapabilityKind,
    CapabilityModuleDescriptionSheet,
    CapabilityModuleMeta,
} from '@lixpi/constants'

import { CapabilityActionRegistry } from './capability-action-registry.ts'
import type { CapabilityMediaStrategyRegistry } from './capability-media-strategy-registry.ts'
import type { CapabilityMediaStrategy } from './capability-media-strategy.ts'

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
    mediaStrategies?: CapabilityMediaStrategy[]
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

    registerMediaStrategies(registry: CapabilityMediaStrategyRegistry): void {
        for (const definition of this.modules.values()) {
            for (const strategy of definition.mediaStrategies ?? []) registry.register(strategy)
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
            .filter((definition) =>
                !normalizedQuery
                || definition.normalizedName.startsWith(normalizedQuery)
                || definition.tags.some((tag) => tag.startsWith(normalizedQuery))
            )
            .map((definition) => this.toMeta(definition))
            .sort((left, right) =>
                left.normalizedName.localeCompare(right.normalizedName)
                || left.moduleId.localeCompare(right.moduleId)
            )
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
        validateDescriptionSheet(definition.moduleId, definition.descriptionSheet)

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
            descriptionSheet: structuredClone(definition.descriptionSheet),
        }
    }
}

const DESCRIPTION_LIMITS = {
    purpose: 320,
    expectedInputCount: 12,
    inputName: 80,
    inputDescription: 280,
    listItemCount: 8,
    listItem: 280,
    executionSummary: 240,
} as const

const EXPECTED_INPUT_REQUIREMENTS = new Set(['required', 'optional', 'conditional'])
const EXPECTED_INPUT_KINDS = new Set(['prompt', 'image', 'video', 'audio', 'document', 'artifact', 'parameters'])
const EXECUTION_BANDS = new Set(['low', 'medium', 'high'])
const RAW_HTML_PATTERN = /<\/?[a-z][^>]*>/iu

function validateBoundedText(
    moduleId: string,
    field: string,
    value: unknown,
    maximumLength: number,
): asserts value is string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_${field}_REQUIRED:${moduleId}`)
    }
    if (value.length > maximumLength) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_${field}_TOO_LONG:${moduleId}`)
    }
    if (RAW_HTML_PATTERN.test(value)) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_${field}_HTML_FORBIDDEN:${moduleId}`)
    }
}

function validateDescriptionList(
    moduleId: string,
    field: 'BEST_RESULTS' | 'LIMITATIONS',
    value: unknown,
): asserts value is string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_${field}_REQUIRED:${moduleId}`)
    }
    if (value.length > DESCRIPTION_LIMITS.listItemCount) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_${field}_TOO_MANY:${moduleId}`)
    }
    for (const item of value) {
        validateBoundedText(moduleId, `${field}_ITEM`, item, DESCRIPTION_LIMITS.listItem)
    }
}

function normalizeInputName(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
}

function validateExpectedInput(moduleId: string, input: CapabilityExpectedInput, names: Set<string>): void {
    validateBoundedText(moduleId, 'INPUT_NAME', input?.name, DESCRIPTION_LIMITS.inputName)
    const normalizedName = normalizeInputName(input.name)
    if (names.has(normalizedName)) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_INPUT_NAME_DUPLICATE:${moduleId}:${normalizedName}`)
    }
    names.add(normalizedName)
    if (!EXPECTED_INPUT_REQUIREMENTS.has(input.requirement)) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_INPUT_REQUIREMENT_INVALID:${moduleId}:${normalizedName}`)
    }
    if (
        !Array.isArray(input.accepts) || input.accepts.length === 0
        || input.accepts.some(kind => !EXPECTED_INPUT_KINDS.has(kind))
    ) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_INPUT_ACCEPTS_INVALID:${moduleId}:${normalizedName}`)
    }
    if (new Set(input.accepts).size !== input.accepts.length) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_INPUT_ACCEPTS_DUPLICATE:${moduleId}:${normalizedName}`)
    }
    validateBoundedText(moduleId, 'INPUT_DESCRIPTION', input.description, DESCRIPTION_LIMITS.inputDescription)
}

export function validateDescriptionSheet(
    moduleId: string,
    sheet: CapabilityModuleDescriptionSheet | undefined,
): asserts sheet is CapabilityModuleDescriptionSheet {
    if (!sheet || typeof sheet !== 'object') {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_SHEET_REQUIRED:${moduleId}`)
    }
    validateBoundedText(moduleId, 'PURPOSE', sheet.purpose, DESCRIPTION_LIMITS.purpose)
    if (!Array.isArray(sheet.expectedInputs) || sheet.expectedInputs.length === 0) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_EXPECTED_INPUTS_REQUIRED:${moduleId}`)
    }
    if (sheet.expectedInputs.length > DESCRIPTION_LIMITS.expectedInputCount) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_EXPECTED_INPUTS_TOO_MANY:${moduleId}`)
    }
    const inputNames = new Set<string>()
    for (const input of sheet.expectedInputs) validateExpectedInput(moduleId, input, inputNames)
    validateDescriptionList(moduleId, 'BEST_RESULTS', sheet.bestResults)
    validateDescriptionList(moduleId, 'LIMITATIONS', sheet.limitations)
    if (!sheet.executionCharacteristics || typeof sheet.executionCharacteristics !== 'object') {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_EXECUTION_REQUIRED:${moduleId}`)
    }
    if (!EXECUTION_BANDS.has(sheet.executionCharacteristics.cost)) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_EXECUTION_COST_INVALID:${moduleId}`)
    }
    if (!EXECUTION_BANDS.has(sheet.executionCharacteristics.latency)) {
        throw new Error(`CAPABILITY_MODULE_DESCRIPTION_EXECUTION_LATENCY_INVALID:${moduleId}`)
    }
    validateBoundedText(
        moduleId,
        'EXECUTION_SUMMARY',
        sheet.executionCharacteristics.summary,
        DESCRIPTION_LIMITS.executionSummary,
    )
}

import {
    type CapabilityJsonValue,
    type MediaGenerationConfigSelectionGroup,
} from '@lixpi/constants'

export type SerializedCapabilityInputs = Record<string, Record<string, CapabilityJsonValue>>

export const parseCapabilityInputsAttr = (value: unknown): SerializedCapabilityInputs => {
    if (
        typeof value !== 'string'
        || !value.trim()
    )
        return {}

    try {
        const parsed = JSON.parse(value) as unknown

        if (!isJsonObject(parsed))
            return {}

        return Object.fromEntries(
            Object.entries(parsed).flatMap(
                ([toolId, input]) =>
                    toolId.trim()
                        && isJsonObject(input)
                        ? [[toolId, input as Record<string, CapabilityJsonValue>]]
                        : [],
            ),
        )
    } catch {
        return {}
    }
}

export const serializeCapabilityInputsAttr = (inputs: SerializedCapabilityInputs): string => {
    const entries = Object.entries(inputs).filter(([toolId, input]) => toolId.trim() && isJsonObject(input))

    return entries.length > 0 ? JSON.stringify(
        Object.fromEntries(entries),
    ) : ''
}

export const normalizeCapabilityInputsAttr = (value: unknown): string => {
    if (typeof value === 'string')
        return serializeCapabilityInputsAttr(
            parseCapabilityInputsAttr(value),
        )

    return isJsonObject(value)
        ? serializeCapabilityInputsAttr(value as SerializedCapabilityInputs)
        : ''
}

function isJsonObject(value: unknown): value is Record<string, CapabilityJsonValue> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        && Object.entries(value).every(([key, child]) => isSafeKey(key) && isJsonValue(child))
}

function isJsonValue(value: unknown): value is CapabilityJsonValue {
    if (
        value === null
        || typeof value === 'string'
        || typeof value === 'boolean'
    )
        return true

    if (typeof value === 'number')
        return Number.isFinite(value)

    if (Array.isArray(value))
        return value.every(isJsonValue)

    return isJsonObject(value)
}

function isSafeKey(key: string): boolean {
    return key !== '__proto__' && key !== 'prototype' && key !== 'constructor'
}

export const parseAiModelSelectionAttr = (value: unknown): string[] => {
    if (Array.isArray(value))
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)

    if (typeof value !== 'string')
        return []

    const trimmed = value.trim()

    if (!trimmed)
        return []

    try {
        const parsed = JSON.parse(trimmed) as unknown

        if (Array.isArray(parsed))
            return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    } catch {
        return []
    }

    return []
}

export const serializeAiModelSelectionAttr = (models: readonly string[]): string => {
    const uniqueModels = Array.from(
        new Set(
            models.filter(model => model.trim().length > 0),
        ),
    )

    return uniqueModels.length > 0 ? JSON.stringify(uniqueModels) : ''
}

export const normalizeAiModelSelectionAttr = (value: unknown): string => {
    return serializeAiModelSelectionAttr(
        parseAiModelSelectionAttr(value),
    )
}

export const parseMediaGenerationConfigSelectionAttr = (value: unknown): MediaGenerationConfigSelectionGroup[] => {
    if (typeof value !== 'string')
        return []

    const trimmed = value.trim()

    if (!trimmed)
        return []

    try {
        const parsed = JSON.parse(trimmed) as unknown

        if (!Array.isArray(parsed))
            return []

        return parsed.flatMap((entry): MediaGenerationConfigSelectionGroup[] => {
            if (
                !entry
                || typeof entry !== 'object'
            )
                return []

            const candidate = entry as Record<string, unknown>

            if (
                typeof candidate.groupId !== 'string'
                || !candidate.groupId
            )
                return []

            if (!Array.isArray(candidate.modelIds))
                return []

            const modelIds = candidate.modelIds.filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
            const rawValues = candidate.values
                && typeof candidate.values === 'object'
                ? candidate.values as Record<string, unknown>
                : {}
            const values = Object.fromEntries(
                Object.entries(rawValues).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
            )

            return [{
                groupId: candidate.groupId,
                modelIds: modelIds as MediaGenerationConfigSelectionGroup['modelIds'],
                values,
            }]
        })
    } catch {
        return []
    }
}

export const serializeMediaGenerationConfigSelectionAttr = (groups: readonly MediaGenerationConfigSelectionGroup[]): string => {
    const normalizedGroups = groups.map(
        group => ({
            groupId: group.groupId,
            modelIds: Array.from(
                new Set(
                    group.modelIds.filter(modelId => modelId.trim().length > 0),
                ),
            ),
            values: Object.fromEntries(
                Object.entries(group.values).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0),
            ),
        }),
    ).filter(group => group.groupId && group.modelIds.length > 0)

    return normalizedGroups.length > 0 ? JSON.stringify(normalizedGroups) : ''
}

export const normalizeMediaGenerationConfigSelectionAttr = (value: unknown): string => {
    return serializeMediaGenerationConfigSelectionAttr(
        parseMediaGenerationConfigSelectionAttr(value),
    )
}

export const parseBooleanAttr = (value: unknown): boolean => value === true || value === 'true'

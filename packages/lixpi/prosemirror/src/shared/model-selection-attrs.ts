import type { MediaGenerationConfigSelectionGroup } from '@lixpi/constants'

export function parseAiModelSelectionAttr(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    }

    if (typeof value !== 'string') return []
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) {
            return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        }
    } catch {
        return []
    }

    return []
}

export function serializeAiModelSelectionAttr(models: readonly string[]): string {
    const uniqueModels = Array.from(new Set(models.filter((model) => model.trim().length > 0)))
    return uniqueModels.length > 0 ? JSON.stringify(uniqueModels) : ''
}

export function normalizeAiModelSelectionAttr(value: unknown): string {
    return serializeAiModelSelectionAttr(parseAiModelSelectionAttr(value))
}

export function parseMediaGenerationConfigSelectionAttr(value: unknown): MediaGenerationConfigSelectionGroup[] {
    if (typeof value !== 'string') return []
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
        const parsed = JSON.parse(trimmed) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.flatMap((entry): MediaGenerationConfigSelectionGroup[] => {
            if (!entry || typeof entry !== 'object') return []
            const candidate = entry as Record<string, unknown>
            if (typeof candidate.groupId !== 'string' || !candidate.groupId) return []
            if (!Array.isArray(candidate.modelIds)) return []

            const modelIds = candidate.modelIds
                .filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
            const rawValues = candidate.values && typeof candidate.values === 'object'
                ? candidate.values as Record<string, unknown>
                : {}
            const values = Object.fromEntries(
                Object.entries(rawValues)
                    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
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

export function serializeMediaGenerationConfigSelectionAttr(groups: readonly MediaGenerationConfigSelectionGroup[]): string {
    const normalizedGroups = groups
        .map(group => ({
            groupId: group.groupId,
            modelIds: Array.from(new Set(group.modelIds.filter(modelId => modelId.trim().length > 0))),
            values: Object.fromEntries(
                Object.entries(group.values)
                    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
            ),
        }))
        .filter(group => group.groupId && group.modelIds.length > 0)

    return normalizedGroups.length > 0 ? JSON.stringify(normalizedGroups) : ''
}

export function normalizeMediaGenerationConfigSelectionAttr(value: unknown): string {
    return serializeMediaGenerationConfigSelectionAttr(parseMediaGenerationConfigSelectionAttr(value))
}

export function parseBooleanAttr(value: unknown): boolean {
    return value === true || value === 'true'
}

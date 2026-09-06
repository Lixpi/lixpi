// Providers publish the same model twice: a moving alias and one or more dated
// snapshots behind it. `gpt-5` and `gpt-5-2025-08-07` are one model, as are
// `claude-haiku-4-5` and `claude-haiku-4-5-20251001`.
//
// The catalog holds one entry per family, named without the snapshot suffix, and
// carries the concrete id to call in `model` and `modelVersion`. A version number
// that is part of the model's name is not a snapshot: `gpt-5.5`, `claude-opus-4-6`,
// `gemini-2.5-pro`, and `dreamina-seedance-2-0` all keep theirs.

// Ordered most specific first, so a full date is matched before a bare year-month.
const SNAPSHOT_SUFFIXES = [
    // 2025-08-07
    /-\d{4}-\d{2}-\d{2}$/u,
    // 05-2026, the month-year Google puts on its previews
    /-\d{2}-\d{4}$/u,
    // 20251001
    /-\d{8}$/u,
    // 260128
    /-\d{6}$/u,
    // 0613, 0125
    /-\d{4}$/u,
    // -v1, -v1:0, -v1:0:200k
    /-v\d+(?::[A-Za-z0-9]+)*$/u,
]

export const familyId = (modelId: string): string => {
    for (const pattern of SNAPSHOT_SUFFIXES) {
        if (pattern.test(modelId))
            return modelId.replace(pattern, '')
    }

    return modelId
}

export const snapshotSuffix = (modelId: string): string | null => {
    const family = familyId(modelId)

    return family === modelId
        ? null
        : modelId.slice(family.length + 1)
}

// The id to actually call. A provider's moving alias wins when it is published,
// because it is what the vendor points at the current release. Otherwise the highest
// snapshot suffix wins, which sorts correctly for every date shape above.
export const pickLatest = (modelIds: string[]): string => {
    const alias = modelIds.find(modelId => snapshotSuffix(modelId) === null)

    if (alias)
        return alias

    return [...modelIds].sort((left, right) => (snapshotSuffix(right) ?? '').localeCompare(snapshotSuffix(left) ?? ''))[0]!
}

export type ModelFamily = {
    family: string
    latest: string
    versions: string[]
}

export const groupIntoFamilies = (modelIds: string[]): ModelFamily[] => {
    const families = new Map<string, string[]>()

    for (const modelId of modelIds) {
        const family = familyId(modelId)
        families.set(family, [...(families.get(family) ?? []), modelId])
    }

    return [...families.entries()].map(
        ([family, versions]) => ({
            family,
            latest: pickLatest(versions),
            versions: [...versions].sort(),
        }),
    )
        .sort((left, right) => left.family.localeCompare(right.family))
}

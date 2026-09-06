// Bedrock model ids reach Lixpi through three different shapes: the AWS listing
// (`anthropic.claude-haiku-4-5-20251001-v1:0`), LiteLLM keys that may carry a
// route or region prefix (`bedrock/us-gov-east-1/anthropic.claude-...`,
// `us.anthropic.claude-...`), and models.dev keys under its amazon-bedrock provider.
//
// All three reduce to the vendor's own model id, which is what the catalog matches
// against. Reducing them the same way everywhere is what stops a model looking
// uncovered because one source spelled its key differently.

const ROUTE_PREFIX = /^bedrock\/(?:[a-z0-9-]+\/)?/u
// Cross-region inference profiles. `us.` and friends carry a premium over the plain
// key, so they are recognised but marked, not treated as the base rate.
const REGION_PREFIX = /^(?:us|eu|apac|au|jp|global|us-gov)\./u
const VENDOR_PREFIX = /^[a-z0-9-]+\./iu
const VERSION_TAIL = /-v\d+(?::[A-Za-z0-9]+)*$/u

export type BedrockKey = {
    // The vendor's model id with every prefix and version tail removed.
    vendorModelId: string
    // True when the key is a cross-region inference profile rather than the base
    // on-demand entry.
    isRegionalProfile: boolean
}

export const parseBedrockKey = (key: string): BedrockKey | null => {
    let rest = key.replace(ROUTE_PREFIX, '')
    const isRegionalProfile = REGION_PREFIX.test(rest)
    rest = rest.replace(REGION_PREFIX, '')

    if (!VENDOR_PREFIX.test(rest))
        return null

    const vendorModelId = rest
        .replace(VENDOR_PREFIX, '')
        .replace(VERSION_TAIL, '')

    if (!vendorModelId)
        return null

    return {
        vendorModelId,
        isRegionalProfile,
    }
}

// Indexes a source's Bedrock keys by vendor model id. The plain on-demand key wins
// over a regional profile, so a later regional entry never displaces one.
export const indexBedrockKeys = <T>(
    entries: Iterable<[string, T]>,
    isBedrockEntry: (entry: T) => boolean,
): Map<string, {
    key: string
    entry: T
}> => {
    const index = new Map<string, {
        key: string
        entry: T
        isRegionalProfile: boolean
    }>()

    for (const [key, entry] of entries) {
        if (!isBedrockEntry(entry))
            continue

        const parsed = parseBedrockKey(key)

        if (!parsed)
            continue

        const existing = index.get(parsed.vendorModelId)

        if (
            existing
            && !existing.isRegionalProfile
        )
            continue

        index.set(
            parsed.vendorModelId,
            {
                key,
                entry,
                isRegionalProfile: parsed.isRegionalProfile,
            },
        )
    }

    return index
}

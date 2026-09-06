import {
    GetProductsCommand,
    PricingClient,
} from '@aws-sdk/client-pricing'
import { fromSSO } from '@aws-sdk/credential-providers'
import process from 'node:process'

import { info } from '@lixpi/debug-tools'

// What AWS charges for a Bedrock model, from the AWS Price List Query API. The
// Bedrock control plane publishes no rates at all, so this is the only place the
// account's own numbers can be read, and it is the bill Lixpi actually pays on the
// Bedrock route rather than an aggregator's copy of a public price page.
//
// The Price List API answers only in us-east-1, ap-south-1, and eu-central-1
// whatever region it is asked about, so the client is pinned there and the region
// under discussion is a filter instead.
const PRICING_API_REGION = 'us-east-1'

// Bedrock rates are spread across three service codes and no single one of them is
// enough. `AmazonBedrock` carries only the models sold before roughly 2024, the
// current per-model token SKUs moved to `AmazonBedrockService`, and the models AWS
// bills through the marketplace, which is every Stability endpoint, are per-image
// SKUs under `AmazonBedrockFoundationModels`. Reading one and calling it the Bedrock
// price list is how a current model ends up looking free.
const SERVICE_CODES = [
    'AmazonBedrock',
    'AmazonBedrockService',
    'AmazonBedrockFoundationModels',
]

const PER_MILLION = 1000000

// Roles a SKU can price. `cache-read-tokens` and the customization SKUs are read and
// discarded: the model record has no field for them, and dropping them into the
// prompt or completion rate would misprice every cached call.
const TOKEN_ROLES = new Set([
    'input-tokens',
    'output-tokens',
    'input-image-token-count',
    'output-image-token-count',
])

// Serving tiers that are not the rate an ordinary streaming call pays. Batch, flex,
// and priority are opt-in throughput modes Lixpi does not request, and a custom-model
// SKU prices a fine-tune nobody in this catalog has.
const NON_STANDARD_TIER_TOKENS = [
    'batch',
    'flex',
    'priority',
    'custom-model',
    'provisioned',
    // Reserved throughput is sold by tokens per minute per month, not per call.
    'reserved',
    'per-minute',
    // A long-context call is billed at its own premium above a threshold. The base
    // rate is what an ordinary request pays.
    'long-context',
]

// A global inference profile is priced apart from the plain regional entry, and for
// the current Claude models it is the cheaper of the two: Opus 5 is 5.00/25.00 per
// million globally against 5.50/27.50 regionally. A geo profile (`us.`, `eu.`) bills
// at the regional rate, so only `global` and AWS's older `cross-region` spelling
// select this tier. Both are kept and the one reported is the one matching how the
// model is actually invoked.
const GLOBAL_PROFILE_TIER_TOKENS = [
    'cross-region',
    'global',
]

// A marketplace SKU is written in an entirely different shape and, for the token
// models, does not name the model at all: `USE1-MP:USE1_input_tokens_global_standard-Units`
// is Claude Opus 5 only because the SKU's `servicename` says
// "Claude Opus 5 (Amazon Bedrock Edition)". The image models do carry the name
// (`USE1-MP:USE1_created_image_stable_image_ultra-Units`). Every current Claude model
// is billed this way, so a price list read without this shape has rates for nothing
// newer than Claude 3.
const MARKETPLACE_USAGE_TYPE = /^MP:[A-Za-z0-9]+_(?<body>.+)-Units$/u

const MARKETPLACE_IMAGE_BODY = /^created_(?<kind>[a-z]+)_(?<modelKey>.+)$/u

// The marketplace writes the same role two ways, `InputTokenCount` on the older
// products and `input_tokens` on the newer ones.
const MARKETPLACE_ROLES: Array<[RegExp, string]> = [
    [/^inputtokencount$|^inputtokens$/u, 'input-tokens'],
    [/^outputtokencount$|^outputtokens$/u, 'output-tokens'],
]

// Everything the marketplace prices that is not the rate an ordinary streaming call
// pays: cached reads and writes, batch, reserved throughput per minute, and the
// latency-optimized tier.
const MARKETPLACE_EXCLUDED = [
    'cache',
    'batch',
    'reserved',
    'tpm',
    'latencyoptimized',
    'priority',
    'flex',
]

// `USE1-`, `USW2-`, `EU-`, `APS6-`. The rest of the usage type is the model key
// followed by its role and tier.
const REGION_ABBREVIATION = /^[A-Z]{2,4}\d{0,2}-/u

const USAGE_TYPE = new RegExp(
    `^(?<modelKey>.+?)-(?<role>${[...TOKEN_ROLES].join('|')}|cache-read-tokens|cache-write-tokens)(?<tier>-[a-z0-9-]+)?$`,
    'u',
)

// `regional` is the plain on-demand rate in the account's own region, which a geo
// inference profile also bills at. `global-profile` is the separate rate a global
// profile carries.
export type BedrockRateTier = 'regional' | 'global-profile'

export type BedrockModelRates = {
    // Per million tokens, as the catalog states every token rate.
    promptPerMillionTokens?: string
    completionPerMillionTokens?: string
    imagePromptPerMillionTokens?: string
    imageCompletionPerMillionTokens?: string
    // Per generated image, for the image models AWS bills that way.
    pricePerImage?: string
    // The usage types these rates were read from, so a number can be traced back to
    // the line it will appear on in the bill.
    usageTypes: string[]
}

type PriceListProduct = {
    product?: {
        attributes?: {
            usagetype?: string
            model?: string
            // The marketplace products carry the model here and nowhere else, as
            // "Claude Opus 5 (Amazon Bedrock Edition)".
            servicename?: string
            regionCode?: string
        }
    }
    terms?: {
        OnDemand?: Record<string, {
            priceDimensions?: Record<string, {
                unit?: string
                pricePerUnit?: { USD?: string }
            }>
        }>
    }
}

type ParsedUsageType = {
    // Null on a marketplace token SKU, whose usage type names only the role. The
    // model comes from the product's `servicename` there.
    modelKey: string | null
    role: string
    tier: BedrockRateTier
}

// Every rate in the catalog is a fixed-point string, so a Bedrock rate is formatted
// the same way. Two places is what the token rates in this catalog need; a rate that
// would round to nothing keeps enough places to stay a number.
const toRate = (amount: number): string => (amount >= 0.01
    ? amount.toFixed(2)
    : amount.toFixed(6).replace(/0+$/u, ''))

const normalizeName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, '')

// AWS states a token rate per thousand on the ordinary SKUs and per million on the
// marketplace ones. Reading a `1M tokens` rate as though it were per thousand
// multiplies every price by a thousand, so the unit decides the scale rather than a
// constant.
const perMillionTokens = (
    unit: string,
    amount: number,
): number | null => {
    const normalized = unit.toLowerCase()

    if (!normalized.includes('token'))
        return null

    if (normalized.includes('1m'))
        return amount

    if (normalized.includes('1k'))
        return amount * 1000

    // A bare `tokens` unit is a per-token rate.
    return amount * PER_MILLION
}

const MARKETPLACE_TITLE_SUFFIX = / \(Amazon Bedrock Edition\)$/u

const parseMarketplaceUsageType = (body: string): ParsedUsageType | null => {
    const image = MARKETPLACE_IMAGE_BODY.exec(body)

    // An image product prices one generated output and has no tier.
    if (image?.groups) {
        return {
            modelKey: image.groups.modelKey!,
            role: `${image.groups.kind}-output`,
            tier: 'regional',
        }
    }

    const words = body.toLowerCase().split('_')

    if (MARKETPLACE_EXCLUDED.some(token => words.some(word => word.includes(token))))
        return null

    // `standard` is the marketplace's word for the ordinary tier and says nothing
    // about the model, so it drops out along with `global`, which is the tier itself.
    const role = words
        .filter(word => word !== 'global' && word !== 'standard')
        .join('')

    const matched = MARKETPLACE_ROLES.find(([pattern]) => pattern.test(role))

    if (!matched)
        return null

    return {
        modelKey: null,
        role: matched[1],
        tier: words.includes('global')
            ? 'global-profile'
            : 'regional',
    }
}

const parseUsageType = (usageType: string): ParsedUsageType | null => {
    const rest = usageType.replace(REGION_ABBREVIATION, '')
    const marketplace = MARKETPLACE_USAGE_TYPE.exec(rest)

    if (marketplace?.groups)
        return parseMarketplaceUsageType(marketplace.groups.body!)

    const match = USAGE_TYPE.exec(rest)

    if (!match?.groups)
        return null

    const {
        modelKey,
        role,
    } = match.groups
    const tier = (match.groups.tier ?? '').toLowerCase()

    if (!TOKEN_ROLES.has(role!))
        return null


    // Matched against the whole usage type, not only the tail. AWS puts the commitment
    // in the middle of the name (`Claude4.5Sonnet-reserved-3-month-input-tokens-per-
    // minute-cross-region-geo`), so a tail-only check lets a reserved-throughput rate
    // through as though it were the on-demand one.
    if (NON_STANDARD_TIER_TOKENS.some(token => rest.toLowerCase().includes(token)))
        return null

    return {
        modelKey: modelKey!,
        role: role!,
        tier: GLOBAL_PROFILE_TIER_TOKENS.some(token => tier.includes(token))
            ? 'global-profile'
            : 'regional',
    }
}

// One model's rates, per tier, while they are being collected.
class RateBuilder {
    readonly tiers = new Map<BedrockRateTier, BedrockModelRates>()

    private tier(tier: BedrockRateTier): BedrockModelRates {
        const existing = this.tiers.get(tier)

        if (existing)
            return existing

        const created: BedrockModelRates = { usageTypes: [] }
        this.tiers.set(tier, created)

        return created
    }

    add(
        parsed: ParsedUsageType,
        usageType: string,
        unit: string,
        amount: number,
    ): void {
        const rates = this.tier(parsed.tier)

        // The unit decides which field the number belongs in, because a per-image
        // price written into a per-token field is wrong by six orders of magnitude. A
        // unit that is neither is a SKU this catalog has no field for, and it is left
        // out rather than recorded as a rate nobody read.
        const tokens = perMillionTokens(unit, amount)

        if (tokens !== null) {
            rates.usageTypes.push(usageType)
            const perMillion = toRate(tokens)

            if (parsed.role === 'input-tokens')
                rates.promptPerMillionTokens = perMillion

            if (parsed.role === 'output-tokens')
                rates.completionPerMillionTokens = perMillion

            if (parsed.role === 'input-image-token-count')
                rates.imagePromptPerMillionTokens = perMillion

            if (parsed.role === 'output-image-token-count')
                rates.imageCompletionPerMillionTokens = perMillion

            return
        }

        if (unit.toLowerCase().includes('image')) {
            rates.usageTypes.push(usageType)
            rates.pricePerImage = toRate(amount)
        }
    }
}

// The Bedrock price list for one region, indexed by every key a model can be found
// under: the vendor's own model id as it appears in the usage type, and the model's
// display name for the older SKUs that spell it `Claude3Haiku` instead.
export class BedrockPricing {
    private readonly byModelKey = new Map<string, RateBuilder>()
    private loaded = false

    constructor(private readonly region: string) {}

    private client(): PricingClient {
        const profile = process.env.AWS_PROFILE

        return new PricingClient({
            region: PRICING_API_REGION,
            ...(profile && { credentials: fromSSO({ profile }) }),
        })
    }

    // The price list is filtered by region only. Filtering on `feature` or
    // `inferenceType`, which the API also accepts, drops every model added in the
    // last two years: AWS leaves those attributes empty on the newer SKUs and only
    // the usage type identifies them.
    async load(): Promise<void> {
        const client = this.client()
        let skus = 0

        for (const serviceCode of SERVICE_CODES) {
            let nextToken: string | undefined

            do {
                const response = await client.send(
                    new GetProductsCommand({
                        ServiceCode: serviceCode,
                        Filters: [
                            {
                                Type: 'TERM_MATCH',
                                Field: 'regionCode',
                                Value: this.region,
                            },
                        ],
                        MaxResults: 100,
                        NextToken: nextToken,
                    }),
                )

                for (const entry of response.PriceList ?? []) {
                    skus += 1
                    this.absorb(JSON.parse(String(entry)) as PriceListProduct)
                }

                nextToken = response.NextToken
            } while (nextToken)
        }

        this.loaded = true
        info(`Bedrock price list loaded for ${this.region}: ${skus} SKUs across ${SERVICE_CODES.length} service codes, ${this.byModelKey.size} models priced`)
    }

    private absorb(product: PriceListProduct): void {
        const attributes = product.product?.attributes
        const usageType = attributes?.usagetype

        if (!usageType)
            return

        const parsed = parseUsageType(usageType)

        if (!parsed)
            return

        // A marketplace token SKU is identified by its product name and nothing else.
        const serviceName = attributes?.servicename?.replace(MARKETPLACE_TITLE_SUFFIX, '')
        const modelKey = parsed.modelKey ?? serviceName

        if (!modelKey)
            return

        for (const term of Object.values(product.terms?.OnDemand ?? {})) {
            for (const dimension of Object.values(term.priceDimensions ?? {})) {
                const amount = Number(dimension.pricePerUnit?.USD)

                // A zero rate is a placeholder AWS publishes for SKUs that are not
                // separately billed, not a free model.
                if (
                    !Number.isFinite(amount)
                    || amount === 0
                )
                    continue

                const builder = this.builderFor(modelKey, attributes?.model)
                builder.add(
                    parsed,
                    usageType,
                    dimension.unit ?? '',
                    amount,
                )
            }
        }
    }

    private builderFor(
        modelKey: string,
        displayName: string | undefined,
    ): RateBuilder {
        const key = normalizeName(modelKey)
        const builder = this.byModelKey.get(key) ?? new RateBuilder()
        this.byModelKey.set(key, builder)

        // A usage type spells the model three ways depending on its age:
        // `Claude3Haiku`, `anthropic.claude-haiku-4-5-mantle`, or a display name in
        // the `model` attribute. All of them are indexed, including the vendor-
        // stripped form, because the catalog looks a model up by the vendor's own id
        // and would otherwise miss the dotted keys entirely.
        const withoutVendor = modelKey.includes('.')
            ? normalizeName(modelKey.slice(modelKey.indexOf('.') + 1))
            : ''

        if (withoutVendor)
            this.byModelKey.set(withoutVendor, builder)

        if (displayName)
            this.byModelKey.set(normalizeName(displayName), builder)

        return builder
    }

    // A tier that collected no rate is a SKU shape the catalog has no field for, and
    // an empty tier in the file would read as a model priced at nothing.
    private static withRates(tiers: Map<BedrockRateTier, BedrockModelRates>): Map<BedrockRateTier, BedrockModelRates> | null {
        const kept = new Map(
            [...tiers].filter(([, rates]) => rates.usageTypes.length > 0),
        )

        return kept.size > 0
            ? kept
            : null
    }

    isLoaded(): boolean {
        return this.loaded
    }

    // Tried in order: the vendor model id as the usage type spells it, then the
    // display name Bedrock publishes for the model. A usage type may carry a serving
    // suffix the model id does not (`google.gemma-4-31b-mantle`), so a key that
    // starts with the vendor id counts as the same model.
    lookup(candidates: string[]): Map<BedrockRateTier, BedrockModelRates> | null {
        for (const candidate of candidates) {
            const key = normalizeName(candidate)

            if (!key)
                continue

            const exact = this.byModelKey.get(key)
            const rates = exact
                ? BedrockPricing.withRates(exact.tiers)
                : null

            if (rates)
                return rates
        }

        // A usage type can carry a serving suffix the model id does not
        // (`google.gemma-4-31b-mantle`), so a key that starts with the vendor id is
        // the same model. The shortest such key wins: `zai.glm-4.7` must not resolve
        // to `zai.glm-4.7-flash`, which is a different model at a different rate.
        for (const candidate of candidates) {
            const key = normalizeName(candidate)

            if (key.length < 6)
                continue

            const matches = [...this.byModelKey.keys()]
                .filter(indexed => indexed.startsWith(key))
                .sort((left, right) => left.length - right.length)

            for (const match of matches) {
                const rates = BedrockPricing.withRates(this.byModelKey.get(match)!.tiers)

                if (rates)
                    return rates
            }
        }

        return null
    }
}

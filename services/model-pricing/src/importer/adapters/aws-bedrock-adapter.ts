'use strict'

import type { PriceEvidence } from '@lixpi/constants'
import { fetchAllowlistedText } from '../secure-fetch.ts'
import { buildDirectRateVariant } from './price-variant-builder.ts'
import type { PricingCandidate, ProviderAdapter, ProviderValidationResult } from '../types.ts'

// AWS Price List Bulk API - static, unauthenticated JSON, no SDK/credentials
// needed (unlike the signed `pricing:GetProducts` API). This is the exact
// "AmazonBedrockFoundationModels" current offer file; confirmed live and
// ~5.9 MB during planning.
const OFFER_URL = 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/index.json'
const OFFER_ORIGIN = 'https://pricing.us-east-1.amazonaws.com'
const PARSER_VERSION = 'aws-bedrock-price-list-v3'
const MAX_OFFER_BYTES = 32 * 1024 * 1024

type AwsPriceListProduct = {
    sku: string
    attributes: {
        servicename?: string
        regionCode?: string
        usagetype?: string
    }
}

type AwsPriceListDocument = {
    products: Record<string, AwsPriceListProduct>
    terms: {
        OnDemand?: Record<string, Record<string, {
            priceDimensions: Record<string, { unit?: string; pricePerUnit?: { USD?: string } }>
        }>>
    }
}

// Reviewed vendorModel prefix -> the exact "servicename" prefix Bedrock uses
// for that model family, e.g. "Claude Opus 5 (Amazon Bedrock Edition)", plus
// which `usagetype` naming convention that family's SKUs use (see
// `USAGE_TYPE_SUFFIXES` below). Scoped to Anthropic models for this pass;
// Stability-via-Bedrock uses a different servicename convention that hasn't
// been verified yet, so it holds rather than guesses.
//
// Verified against a real fetch of the offer file: `claude-haiku-3-5`'s
// servicename is "Claude 3.5 Haiku", not "Claude Haiku 3.5" - the version
// number sits before "Haiku" for the 3.x generation, after it from 4.x
// onward. The previous mapping was never checked against real data and
// would have held every Claude 3.5 Haiku candidate as
// missing-upstream-entry forever.
const SERVICE_NAME_BY_PREFIX: ReadonlyArray<readonly [prefix: string, serviceName: string, usageTypeConvention: 'current' | 'legacy']> = [
    ['claude-opus-4-1', 'Claude Opus 4.1', 'current'],
    ['claude-opus-4-5', 'Claude Opus 4.5', 'current'],
    ['claude-opus-4-6', 'Claude Opus 4.6', 'current'],
    ['claude-opus-4-7', 'Claude Opus 4.7', 'current'],
    ['claude-opus-4-8', 'Claude Opus 4.8', 'current'],
    ['claude-opus-4', 'Claude Opus 4', 'current'],
    ['claude-opus-5', 'Claude Opus 5', 'current'],
    ['claude-sonnet-4-5', 'Claude Sonnet 4.5', 'current'],
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6', 'current'],
    ['claude-sonnet-4', 'Claude Sonnet 4', 'current'],
    ['claude-sonnet-5', 'Claude Sonnet 5', 'current'],
    // Verified against a real fetch: Haiku 4.5 and 3.5 both price on-demand
    // input/output through a PascalCase, no-"_standard" usagetype
    // ("InputTokenCount-Units"/"OutputTokenCount-Units"), not the
    // snake_case "_standard" suffix current-generation models use.
    ['claude-haiku-4-5', 'Claude Haiku 4.5', 'legacy'],
    ['claude-haiku-3-5', 'Claude 3.5 Haiku', 'legacy'],
]

const serviceNameFor = (vendorModel: string): { serviceName: string; usageTypeConvention: 'current' | 'legacy' } | undefined => {
    const match = SERVICE_NAME_BY_PREFIX.find(([prefix]) => vendorModel.startsWith(prefix))
    return match && { serviceName: match[1], usageTypeConvention: match[2] }
}

// The exact, anchored `usagetype` tail (always immediately preceded by "_"
// and terminal - AWS's Price List usagetype is always "<descriptor>-Units")
// identifying the plain on-demand regional rate for each convention.
// Current-generation models fan out {standard, batch} x {global, regional} x
// {input, output, cache_*} under a shared "_tokens_..." stem, so the
// "_standard" qualifier is what selects the plain regional rate over its
// "_global_standard"/"_batch" siblings. Legacy models instead fan out
// "TokenCount" x {none, _Batch, _Global, _Global_Batch} for input/output,
// and separately "CacheReadInputTokenCount"/"CacheWriteInputTokenCount"/
// "CacheWrite1hInputTokenCount" (camelCase-concatenated, no separating "_",
// so they never match an anchor requiring "_" immediately before
// "InputTokenCount") - the bare "InputTokenCount-Units"/"OutputTokenCount-
// Units" tail, with no qualifier at all, is what selects the plain regional
// rate here. Confirmed unique (exactly one match per region/direction) for
// both Claude Haiku 4.5 and Claude 3.5 Haiku against a real fetch of the
// offer file.
const USAGE_TYPE_SUFFIXES: Record<'current' | 'legacy', { input: string; output: string }> = {
    current: { input: '_input_tokens_standard-Units', output: '_output_tokens_standard-Units' },
    legacy: { input: '_InputTokenCount-Units', output: '_OutputTokenCount-Units' },
}

const trimTrailingZeros = (decimal: string): string => decimal.includes('.')
    ? decimal.replace(/0+$/, '').replace(/\.$/, '')
    : decimal

// Converts a raw AWS per-unit USD price into a per-million-tokens decimal
// string using exact string decimal shifting (no floating-point
// multiplication), based on the `unit` field's declared granularity.
// Verified against a real fetch of the offer file: current-generation
// Claude-on-Bedrock SKUs price directly in USD per "1M tokens" (no shift
// needed at all) - an earlier version of this function assumed a per-token
// or per-1K-token unit and shifted an already-per-million price by another
// 6 decimal places, producing a price 1,000,000x too high. The per-token/
// per-1K branches are kept only as a documented, unconfirmed fallback for a
// unit shape this pass never actually observed.
const toUsdPerMillion = (rawUsd: string, unit: string): string | undefined => {
    if (/\b1m\b/i.test(unit)) return trimTrailingZeros(rawUsd)

    const decimalPlaces = /\b1k\b|1000/i.test(unit) ? 3 : /token/i.test(unit) ? 6 : undefined
    if (decimalPlaces === undefined) return undefined

    const [whole, fraction = ''] = rawUsd.split('.')
    const paddedFraction = fraction.padEnd(decimalPlaces, '0')
    const shifted = `${whole}${paddedFraction.slice(0, decimalPlaces)}`
    const remainder = paddedFraction.slice(decimalPlaces)
    const normalized = remainder ? `${shifted}.${remainder}` : shifted
    // Strip leading zeros without losing a leading "0." for sub-$1 amounts.
    return trimTrailingZeros(normalized.replace(/^0+(?=\d)/, ''))
}

const findSkuRate = (
    document: AwsPriceListDocument,
    serviceName: string,
    regionCode: string,
    usageTypeSuffix: string,
): { amount: string; sku: string; usagetype: string } | undefined => {
    // Verified against a real fetch: a given servicename+region carries up to
    // 14 (current-generation) or dozens (legacy, including Reserved-capacity
    // SKUs) usagetype rows. `usageTypeSuffix` is always anchored with a
    // leading "_" and matched against the true end of the string (`endsWith`,
    // not `includes`) so a plain regional rate like "..._input_tokens_
    // standard-Units" or "..._InputTokenCount-Units" can never be satisfied
    // by a longer sibling that merely contains it, e.g.
    // "..._input_tokens_global_standard-Units" (extra suffix after the
    // anchor) or "...CacheReadInputTokenCount-Units" (no "_" before the
    // anchor - "CacheRead"/"CacheWrite"/"CacheWrite1h" are camelCase-
    // concatenated, not underscore-separated, in the legacy convention).
    const matches = Object.values(document.products).filter(product =>
        product.attributes.servicename === serviceName
        && product.attributes.regionCode === regionCode
        && product.attributes.usagetype?.endsWith(usageTypeSuffix))

    if (matches.length !== 1) return undefined

    const product = matches[0]!
    const termsForSku = document.terms.OnDemand?.[product.sku]
    const term = termsForSku && Object.values(termsForSku)[0]
    const dimensions = term && Object.values(term.priceDimensions)
    if (!dimensions || dimensions.length !== 1) return undefined

    const rawUsd = dimensions[0]!.pricePerUnit?.USD
    const unit = dimensions[0]!.unit
    if (!rawUsd || !unit) return undefined

    const amount = toUsdPerMillion(rawUsd, unit)
    if (!amount) return undefined

    return { amount, sku: product.sku, usagetype: product.attributes.usagetype! }
}

// Adapts the `aws-bedrock` route against the AWS Price List Bulk API for
// Bedrock foundation models. Models base input/output token rates only for
// this pass - cache read/write SKUs exist in the same offer file but are a
// documented follow-up, and the "global" vs region-pinned endpoint premium
// Anthropic's own docs describe is not disambiguated here: this deliberately
// matches only the plain regional rate for each convention (see
// `USAGE_TYPE_SUFFIXES`/`findSkuRate`), never the "global" one. Verified
// against a real fetch of the offer file for `claude-opus-4-7`/`4-8`/`5` and
// `claude-sonnet-5`: each resolves to exactly one input/output SKU per
// region, at prices ~10% above Anthropic's direct-API rate (Bedrock's own
// published premium). Claude Haiku 4.5 and Claude 3.5 Haiku, previously held
// unconditionally because this adapter only queried the current-generation
// snake_case convention, are now resolved through the legacy PascalCase
// convention and confirmed against a real fetch: Haiku 4.5 at $1.10/$5.50
// per million (matching the same ~10% premium pattern) and Claude 3.5 Haiku
// at $0.80/$4.00 per million, each with exactly one matching SKU per
// region/direction. Reserved-capacity SKUs remain out of scope for both
// conventions (this pass models on-demand rates only) and are naturally
// excluded by the anchored suffix match, not by a separate check.
export class AwsBedrockPricingAdapter implements ProviderAdapter {
    readonly route = 'aws-bedrock' as const

    // The offer file is ~5.9 MB; every candidate on this route would
    // otherwise re-fetch and re-parse it independently within the same
    // import run. One adapter instance lives for the service's whole
    // lifetime (see `provider-adapters.ts`), so caching the parsed document
    // here means one fetch serves every Bedrock-routed candidate in a run.
    private cached: Promise<{ document: AwsPriceListDocument; resolvedUrl: string }> | undefined

    private fetchOfferDocument(): Promise<{ document: AwsPriceListDocument; resolvedUrl: string }> {
        this.cached ??= (async () => {
            const { text, resolvedUrl } = await fetchAllowlistedText({
                url: OFFER_URL,
                allowedOrigins: new Set([OFFER_ORIGIN]),
                maxBytes: MAX_OFFER_BYTES,
            })
            return { document: JSON.parse(text) as AwsPriceListDocument, resolvedUrl }
        })()
        // A failed fetch/parse must not poison every later candidate for the
        // remainder of the process lifetime - clear the cache so the next
        // candidate retries instead of replaying the same rejection forever.
        this.cached.catch(() => { this.cached = undefined })
        return this.cached
    }

    async validate(candidate: PricingCandidate): Promise<ProviderValidationResult> {
        const { vendorModel, pricingRegion } = candidate.record
        const modelService = serviceNameFor(vendorModel)
        if (!modelService) {
            return {
                status: 'held',
                reason: 'missing-upstream-entry',
                detail: `No reviewed Bedrock servicename mapping for vendor model ${vendorModel}`,
            }
        }
        if (pricingRegion === 'global') {
            return {
                status: 'held',
                reason: 'provider-evidence-unavailable',
                detail: 'Bedrock pricing requires a concrete AWS region; pricingRegion is "global"',
            }
        }

        const serviceName = `${modelService.serviceName} (Amazon Bedrock Edition)`
        const suffixes = USAGE_TYPE_SUFFIXES[modelService.usageTypeConvention]

        let document: AwsPriceListDocument
        let resolvedUrl: string
        try {
            ({ document, resolvedUrl } = await this.fetchOfferDocument())
        } catch {
            return { status: 'held', reason: 'provider-source-invalid', detail: 'AWS Price List offer file could not be fetched or parsed' }
        }

        const input = findSkuRate(document, serviceName, pricingRegion, suffixes.input)
        const output = findSkuRate(document, serviceName, pricingRegion, suffixes.output)
        if (!input || !output) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `Could not find exactly one non-cache input and output SKU for ${serviceName} in ${pricingRegion}`,
            }
        }

        const observedAt = new Date().toISOString()
        const evidenceFor = (sku: string, usagetype: string): PriceEvidence[] => [{
            mechanism: 'aws-price-list',
            sourceId: resolvedUrl,
            sourceLocators: [`sku=${sku}`, `usagetype=${usagetype}`],
            parserVersion: PARSER_VERSION,
            observedAt,
        }]

        const variant = buildDirectRateVariant({}, {
            input: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: input.amount,
                inputId: 'usdPerMillionInputTokens', unit: 'USD/1e6 tokens', evidence: evidenceFor(input.sku, input.usagetype),
            },
            output: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: output.amount,
                inputId: 'usdPerMillionOutputTokens', unit: 'USD/1e6 tokens', evidence: evidenceFor(output.sku, output.usagetype),
            },
        })

        return { status: 'verified', variants: [variant] }
    }
}

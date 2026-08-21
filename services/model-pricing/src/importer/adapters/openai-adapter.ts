'use strict'

import type { PriceEvidence } from '@lixpi/constants'
import { fetchAllowlistedText, ProviderSourceError } from '../secure-fetch.ts'
import { buildDirectRateVariant } from './price-variant-builder.ts'
import type { PricingCandidate, ProviderAdapter, ProviderValidationResult } from '../types.ts'

// The marketing page (openai.com/api/pricing/) returns HTTP 403 to
// server-side fetches. The docs-hosted reference page is publicly fetchable
// and carries the same figures - but NOT as "$X.XX" text: the page renders
// an Astro island (`<astro-island component-export="GroupedPricingTable"
// props="...">`) whose `props` attribute is an HTML-entity-encoded,
// type-tagged JSON blob (`[0, value]` = literal, `[1, [...]]` = array of
// tagged children). There is no dollar sign anywhere in the source; prices
// are bare numbers inside that structure. This adapter decodes and
// interprets that structure directly rather than scanning for currency text.
const PRICING_URL = 'https://developers.openai.com/api/docs/pricing'
const PRICING_ORIGIN = 'https://developers.openai.com'
const PARSER_VERSION = 'openai-pricing-v2'
const MAX_PAGE_BYTES = 4 * 1024 * 1024
const MAX_PROPS_SEARCH_BYTES = 2 * 1024 * 1024

const IMAGE_MODEL_PREFIXES: readonly string[] = [
    'gpt-image-1-mini',
    'gpt-image-1.5',
    'gpt-image-2',
    'gpt-image-1',
]

const matchImageModel = (vendorModel: string): string | undefined =>
    IMAGE_MODEL_PREFIXES.find(prefix => vendorModel.startsWith(prefix))

type TaggedValue = readonly [0, unknown] | readonly [1, readonly unknown[]]

const isTaggedValue = (value: unknown): value is TaggedValue =>
    Array.isArray(value) && value.length === 2 && (value[0] === 0 || value[0] === 1)

// Recursively strips the `[0, x]` / `[1, [...]]` type tags this component's
// serializer wraps every value in, including object property values.
const untag = (value: unknown): unknown => {
    if (!isTaggedValue(value)) return value
    const [tag, inner] = value
    if (tag === 1) return Array.isArray(inner) ? inner.map(untag) : inner
    if (Array.isArray(inner)) return inner.map(untag)
    if (inner !== null && typeof inner === 'object') {
        return Object.fromEntries(Object.entries(inner as Record<string, unknown>).map(([key, val]) => [key, untag(val)]))
    }
    return inner
}

const decodeHtmlEntities = (value: string): string => value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

// Finds every `props="..."` attribute in `html` (bounded per-attribute scan
// - each closing `"` is unambiguous because the JSON inside is HTML-entity
// escaped, so it never contains a literal quote) and returns the decoded,
// parsed, untagged value of the first one whose raw (still-encoded) text
// contains `marker` - e.g. the specific model id we're looking for, since
// this page renders several separate pricing-table islands.
const findIslandPropsContaining = (html: string, marker: string): unknown => {
    const attr = 'props="'
    let searchFrom = 0
    while (true) {
        const start = html.indexOf(attr, searchFrom)
        if (start === -1) return undefined
        const valueStart = start + attr.length
        const valueEnd = html.indexOf('"', valueStart)
        if (valueEnd === -1 || valueEnd - valueStart > MAX_PROPS_SEARCH_BYTES) return undefined

        const raw = html.slice(valueStart, valueEnd)
        if (raw.includes(marker)) {
            try {
                return JSON.parse(decodeHtmlEntities(raw))
            } catch {
                return undefined
            }
        }
        searchFrom = valueEnd + 1
    }
}

type PricingGroup = { model?: string; rows?: unknown }

// Adapts the `openai-api` route against OpenAI's official docs pricing
// reference for the GPT Image model family. Models the "Text" row's input
// rate and the "Image" row's output rate only - there is no
// `PriceComponentKind` slot for image-input tokens distinct from text
// input, so (like Anthropic's 1h cache-write rate) that column is a
// documented gap rather than a misuse of an existing component kind.
export class OpenAiPricingAdapter implements ProviderAdapter {
    readonly route = 'openai-api' as const

    async validate(candidate: PricingCandidate): Promise<ProviderValidationResult> {
        const { vendorModel } = candidate.record
        const modelId = matchImageModel(vendorModel)
        if (!modelId) {
            return {
                status: 'held',
                reason: 'missing-upstream-entry',
                detail: `No reviewed pricing-table mapping for vendor model ${vendorModel}`,
            }
        }

        let text: string
        let resolvedUrl: string
        try {
            ({ text, resolvedUrl } = await fetchAllowlistedText({
                url: PRICING_URL,
                allowedOrigins: new Set([PRICING_ORIGIN]),
                maxBytes: MAX_PAGE_BYTES,
            }))
        } catch (error) {
            if (error instanceof ProviderSourceError) return { status: 'held', reason: error.reason, detail: error.message }
            throw error
        }

        const props = findIslandPropsContaining(text, modelId)
        if (!props || typeof props !== 'object') {
            return {
                status: 'held',
                reason: 'provider-layout-changed',
                detail: `Could not locate or parse a pricing-table island containing ${modelId}`,
            }
        }

        // `groups` is itself a tagged value (`[1, [...]]`), not yet the plain
        // array - untag the container first, then find within it.
        const groups = untag((props as Record<string, unknown>).groups)
        const group = (Array.isArray(groups) ? groups as PricingGroup[] : []).find(candidateGroup => candidateGroup.model === modelId)
        const rows = Array.isArray(group?.rows) ? group.rows as unknown[][] : undefined
        if (!rows) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `Pricing table island did not contain a "rows" array for ${modelId}`,
            }
        }

        // Each row is [modality, input, cachedInput, output], already untagged.
        const textRow = rows.find(row => row[0] === 'Text')
        const imageRow = rows.find(row => row[0] === 'Image')
        const textInput = typeof textRow?.[1] === 'number' ? textRow[1] : undefined
        const imageOutput = typeof imageRow?.[3] === 'number' ? imageRow[3] : undefined
        if (textInput === undefined || imageOutput === undefined) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${modelId}'s rows did not have the expected Text-input/Image-output numeric values`,
            }
        }

        const observedAt = new Date().toISOString()
        const evidence = (locator: string): PriceEvidence[] => [{
            mechanism: 'provider-doc',
            sourceId: resolvedUrl,
            sourceLocators: [locator],
            parserVersion: PARSER_VERSION,
            observedAt,
        }]

        const variant = buildDirectRateVariant({}, {
            input: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: String(textInput),
                inputId: 'usdPerMillionTextInputTokens', unit: 'USD/1e6 tokens',
                evidence: evidence(`groups[model=${modelId}].rows[Text][1]=${textInput}`),
            },
            imageOutput: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: String(imageOutput),
                inputId: 'usdPerMillionImageOutputTokens', unit: 'USD/1e6 tokens',
                evidence: evidence(`groups[model=${modelId}].rows[Image][3]=${imageOutput}`),
            },
        })

        return { status: 'verified', variants: [variant] }
    }
}

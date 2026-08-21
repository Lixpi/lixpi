'use strict'

import type { PriceEvidence, PriceVariant } from '@lixpi/constants'
import { fetchAllowlistedText } from '../secure-fetch.ts'
import { findLabeledAmount, findLabeledWindow, findTaggedAmounts } from '../text-locators.ts'
import { buildDirectRateVariant } from './price-variant-builder.ts'
import type { PricingCandidate, ProviderAdapter, ProviderValidationResult } from '../types.ts'

const PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'
const PRICING_ORIGIN = 'https://ai.google.dev'
const PARSER_VERSION = 'gemini-pricing-v2'
const MODEL_SECTION_WINDOW_CHARS = 2000
const ROW_LABEL_WINDOW_CHARS = 150
const VIDEO_ROW_WINDOW_CHARS = 500
const MAX_PAGE_BYTES = 4 * 1024 * 1024
const RESOLUTIONS = ['720p', '1080p', '4k'] as const

// Flat-rate text models this adapter covers. Anchoring on the bare
// vendorModel slug (e.g. "gemini-2.5-pro"), not the display name
// ("Gemini 2.5 Pro"): the display name is a text-prefix of at least one
// *different* real model's display name ("Gemini 2.5 Pro Preview TTS"),
// separated only by a space - a legitimate word boundary that the
// word-boundary check in text-locators.ts cannot reject. The hyphenated
// slug doesn't have that problem: "gemini-2.5-pro" is never a valid bounded
// match inside "gemini-2.5-pro-preview-tts" because "-" now counts as a
// word character there. Verified against a real raw fetch of the page.
//
// Each model's "Input price"/"Output price" table row is found *within*
// the model's own section window, not by a fixed column position: Gemini's
// real table interleaves a second value per row (a context-band split for
// Pro's ">200k tokens" surcharge, a second modality for Flash's audio
// rate) that a fixed "Nth amount" position would misattribute. Taking the
// first amount after each row label is correct either way - it's always
// the primary/default rate.
const FLAT_RATE_MODELS: readonly string[] = ['gemini-2.5-pro', 'gemini-2.5-flash']

// Reviewed vendorModel prefix -> the exact Veo section label. More specific
// (Fast/Lite) prefixes must be listed before the bare version they would
// otherwise shadow.
const VEO_LABEL_BY_PREFIX: ReadonlyArray<readonly [prefix: string, label: string]> = [
    ['veo-3.1-fast', 'Veo 3.1 Fast'],
    ['veo-3.1-lite', 'Veo 3.1 Lite'],
    ['veo-3.1', 'Veo 3.1 Standard'],
]

const matchPrefix = (
    vendorModel: string,
    table: ReadonlyArray<readonly [string, string]>,
): string | undefined => table.find(([prefix]) => vendorModel.startsWith(prefix))?.[1]

// Adapts the `gemini-api` route against Google's official Gemini API pricing
// docs. Two shapes are handled: flat per-token text pricing (row-label
// search within a per-model section, see FLAT_RATE_MODELS above), and Veo's
// per-second video pricing where each resolution tier is tagged in
// parentheses after the amount rather than carried as a separate table
// column. Gemini 2.5 Pro's >200k-token context surcharge is a documented
// simplification: this only recovers the <=200k default rate, not the
// second tier. `PricingDimension` already has `contextBand` for this -
// extracting the second tier as its own variant is a follow-up, not a
// schema gap.
export class GeminiPricingAdapter implements ProviderAdapter {
    readonly route = 'gemini-api' as const

    async validate(candidate: PricingCandidate): Promise<ProviderValidationResult> {
        const { vendorModel } = candidate.record
        if (vendorModel.includes('image')) {
            return {
                status: 'held',
                reason: 'provider-evidence-unavailable',
                detail: `No reviewed image-generation pricing mapping for ${vendorModel} yet`,
            }
        }

        const veoLabel = matchPrefix(vendorModel, VEO_LABEL_BY_PREFIX)
        if (veoLabel) return this.validateVeo(veoLabel, vendorModel)

        const flatRateModel = FLAT_RATE_MODELS.find(model => vendorModel.startsWith(model))
        if (flatRateModel) return this.validateFlatRate(flatRateModel)

        return {
            status: 'held',
            reason: 'missing-upstream-entry',
            detail: `No reviewed pricing mapping for vendor model ${vendorModel}`,
        }
    }

    private async fetchPricingPage() {
        return fetchAllowlistedText({
            url: PRICING_URL,
            allowedOrigins: new Set([PRICING_ORIGIN]),
            maxBytes: MAX_PAGE_BYTES,
        })
    }

    private async validateFlatRate(modelId: string): Promise<ProviderValidationResult> {
        const { text, resolvedUrl } = await this.fetchPricingPage()

        const section = findLabeledWindow(text, modelId, { withinChars: MODEL_SECTION_WINDOW_CHARS })
        if (!section) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${modelId} is not present (with a nearby price) in the fetched Gemini pricing page`,
            }
        }

        const input = findLabeledAmount(section, 'Input price', { withinChars: ROW_LABEL_WINDOW_CHARS })
        const output = findLabeledAmount(section, 'Output price', { withinChars: ROW_LABEL_WINDOW_CHARS })
        if (!input || !output) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${modelId}'s section is missing an "Input price"/"Output price" row with a nearby amount`,
            }
        }

        const observedAt = new Date().toISOString()
        const evidenceFor = (locator: string): PriceEvidence[] => [{
            mechanism: 'provider-doc',
            sourceId: resolvedUrl,
            sourceLocators: [locator],
            parserVersion: PARSER_VERSION,
            observedAt,
        }]

        const variant = buildDirectRateVariant({}, {
            input: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: input.amount,
                inputId: 'usdPerMillionInputTokens', unit: 'USD/1e6 tokens', evidence: evidenceFor(input.locator),
            },
            output: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: output.amount,
                inputId: 'usdPerMillionOutputTokens', unit: 'USD/1e6 tokens', evidence: evidenceFor(output.locator),
            },
        })

        return { status: 'verified', variants: [variant] }
    }

    private async validateVeo(label: string, vendorModel: string): Promise<ProviderValidationResult> {
        const { text, resolvedUrl } = await this.fetchPricingPage()

        const row = findLabeledWindow(text, label, { withinChars: VIDEO_ROW_WINDOW_CHARS })
        if (!row) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${label} is not present in the fetched Gemini pricing page`,
            }
        }

        const tagged = findTaggedAmounts(row)
        if (tagged.length === 0) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${label}'s row has no resolution-tagged amounts`,
            }
        }

        const observedAt = new Date().toISOString()
        const variants: PriceVariant[] = []

        for (const { amount, tag, locator } of tagged) {
            const lowerTag = tag.toLowerCase()
            for (const resolution of RESOLUTIONS) {
                if (!lowerTag.includes(resolution)) continue

                const evidence: PriceEvidence[] = [{
                    mechanism: 'provider-doc',
                    sourceId: resolvedUrl,
                    sourceLocators: [locator],
                    parserVersion: PARSER_VERSION,
                    observedAt,
                }]

                variants.push(buildDirectRateVariant({ resolution }, {
                    videoOutput: {
                        measuringUnit: 'seconds', pricePer: '1', amount,
                        inputId: 'usdPerSecond', unit: 'USD/second', evidence,
                    },
                }))
            }
        }

        if (variants.length === 0) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${label}'s tagged amounts did not match any known resolution (${vendorModel})`,
            }
        }

        return { status: 'verified', variants }
    }
}

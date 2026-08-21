'use strict'

import type { PriceEvidence } from '@lixpi/constants'
import { fetchAllowlistedText } from '../secure-fetch.ts'
import { findLabeledWindow, findNthAmountInWindow } from '../text-locators.ts'
import { buildDirectRateVariant } from './price-variant-builder.ts'
import type { PricingCandidate, ProviderAdapter, ProviderValidationResult } from '../types.ts'

const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing'
const PRICING_ORIGIN = 'https://platform.claude.com'
const PARSER_VERSION = 'anthropic-pricing-v1'
const ROW_WINDOW_CHARS = 1200
const MAX_PAGE_BYTES = 2 * 1024 * 1024

// Reviewed vendorModel prefix -> the exact display name used as the row
// label in Anthropic's official Model pricing table. Longer/more specific
// prefixes must be listed before shorter ones they would otherwise shadow
// (e.g. "claude-opus-4-1" before bare "claude-opus-4").
const DISPLAY_NAME_BY_PREFIX: ReadonlyArray<readonly [prefix: string, displayName: string]> = [
    ['claude-opus-4-1', 'Claude Opus 4.1'],
    ['claude-opus-4-5', 'Claude Opus 4.5'],
    ['claude-opus-4-6', 'Claude Opus 4.6'],
    ['claude-opus-4-7', 'Claude Opus 4.7'],
    ['claude-opus-4-8', 'Claude Opus 4.8'],
    ['claude-opus-4', 'Claude Opus 4'],
    ['claude-opus-5', 'Claude Opus 5'],
    ['claude-sonnet-4-5', 'Claude Sonnet 4.5'],
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
    ['claude-sonnet-4', 'Claude Sonnet 4'],
    ['claude-sonnet-5', 'Claude Sonnet 5'],
    ['claude-haiku-4-5', 'Claude Haiku 4.5'],
    ['claude-haiku-3-5', 'Claude Haiku 3.5'],
    ['claude-mythos', 'Claude Mythos 5'],
    ['claude-fable', 'Claude Fable 5'],
]

const displayNameFor = (vendorModel: string): string | undefined =>
    DISPLAY_NAME_BY_PREFIX.find(([prefix]) => vendorModel.startsWith(prefix))?.[1]

// Adjudicates the `anthropic-api` route against Anthropic's official docs
// pricing page. Models the Standard-tier Base Input / 5m Cache Write / Cache
// Hit / Output columns only - Batch, Fast mode, and data-residency
// multipliers, and the 1h cache-write rate (no PricingDimension carries
// cache TTL today), are documented gaps for a later pass, not silently
// dropped data.
export class AnthropicPricingAdapter implements ProviderAdapter {
    readonly route = 'anthropic-api' as const

    async validate(candidate: PricingCandidate): Promise<ProviderValidationResult> {
        const displayName = displayNameFor(candidate.record.vendorModel)
        if (!displayName) {
            return {
                status: 'held',
                reason: 'missing-upstream-entry',
                detail: `No reviewed display-name mapping for vendor model ${candidate.record.vendorModel}`,
            }
        }

        const { text, resolvedUrl } = await fetchAllowlistedText({
            url: PRICING_URL,
            allowedOrigins: new Set([PRICING_ORIGIN]),
            maxBytes: MAX_PAGE_BYTES,
        })

        const row = findLabeledWindow(text, displayName, { withinChars: ROW_WINDOW_CHARS })
        if (!row) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${displayName} is not present in the fetched Anthropic pricing table`,
            }
        }

        // Column order in the official table: Base Input, 5m Cache Write,
        // 1h Cache Write (skipped - see class comment), Cache Hit, Output.
        const input = findNthAmountInWindow(row, 0)
        const cacheWrite = findNthAmountInWindow(row, 1)
        const cacheRead = findNthAmountInWindow(row, 3)
        const output = findNthAmountInWindow(row, 4)
        if (!input || !cacheWrite || !cacheRead || !output) {
            return {
                status: 'held',
                reason: 'provider-spec-inconsistent',
                detail: `${displayName}'s pricing row is missing one or more expected columns`,
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
            cacheWrite: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: cacheWrite.amount,
                inputId: 'usdPerMillionCacheWriteTokens', unit: 'USD/1e6 tokens', evidence: evidenceFor(cacheWrite.locator),
            },
            cacheRead: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: cacheRead.amount,
                inputId: 'usdPerMillionCacheReadTokens', unit: 'USD/1e6 tokens', evidence: evidenceFor(cacheRead.locator),
            },
            output: {
                measuringUnit: 'tokens', pricePer: '1000000', amount: output.amount,
                inputId: 'usdPerMillionOutputTokens', unit: 'USD/1e6 tokens', evidence: evidenceFor(output.locator),
            },
        })

        return { status: 'verified', variants: [variant] }
    }
}

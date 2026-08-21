'use strict'

import type { PriceDerivationInput, PriceEvidence, PriceRate, PriceVariant } from '@lixpi/constants'
import { canonicalHash } from '../canonical-json.ts'
import { fetchAllowlistedText, ProviderSourceError } from '../secure-fetch.ts'
import { findLabeledAmount, findLabeledNumber } from '../text-locators.ts'
import type { CandidateHoldReason, PricingCandidate, ProviderAdapter, ProviderValidationResult } from '../types.ts'

const OPENAPI_URL = 'https://api.stability.ai/v2alpha/openapi'
const STABILITY_API_ORIGIN = 'https://api.stability.ai'
const PRICING_PAGE_URL = 'https://platform.stability.ai/pricing'
const PLATFORM_STABILITY_ORIGIN = 'https://platform.stability.ai'
const PARSER_VERSION = 'stability-pricing-v2'
const MAX_OPENAPI_BYTES = 8 * 1024 * 1024
const MAX_SHELL_BYTES = 256 * 1024
const MAX_MODULE_BYTES = 8 * 1024 * 1024

const CHALLENGE_INDICATORS = ['Just a moment', 'cf-chl', 'challenge-platform', 'Checking your browser']

type EndpointKind = 'multi-model' | 'single-model'

// Reviewed vendorModel prefix -> the generation endpoint and how it prices.
// `multi-model` endpoints (sd3 family) select credits through a `model` form
// field and require the operation description and the model property
// description to agree. `single-model` endpoints (ultra) publish one
// sentence naming their own flat credit cost.
const STABILITY_ENDPOINTS: ReadonlyArray<readonly [prefix: string, path: string, kind: EndpointKind]> = [
    ['sd3.5-large', '/v2beta/stable-image/generate/sd3', 'multi-model'],
    ['sd3.5-flash', '/v2beta/stable-image/generate/sd3', 'multi-model'],
    ['sd3', '/v2beta/stable-image/generate/sd3', 'multi-model'],
    ['stability-ultra', '/v2beta/stable-image/generate/ultra', 'single-model'],
]

const matchEndpoint = (vendorModel: string) =>
    STABILITY_ENDPOINTS.find(([prefix]) => vendorModel.startsWith(prefix))

type OpenApiOperation = {
    description?: string
    requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> }
}
type OpenApiSchema = { properties?: Record<string, { enum?: string[]; description?: string }> }
type OpenApiDocument = { paths?: Record<string, Record<string, OpenApiOperation>> }

const held = (reason: CandidateHoldReason, detail: string): ProviderValidationResult => ({ status: 'held', reason, detail })

// Verified against a real fetch of the OpenAPI document: the operation-level
// "### Credits" section and the `model` property's own description name the
// same model through three *different* strings - the operation's intro
// paragraph says "Stable Diffusion 3.5 Large", its "### Credits" bullets say
// "SD 3.5 Large", and only the model property itself uses the API slug
// ("`sd3.5-large`"). Searching for the bare vendorModel slug inside the
// operation description (an earlier version of this adapter did exactly
// that) can never match anything there - this reviewed map supplies the
// "### Credits" section's actual heading text for each slug.
const CREDITS_HEADING_LABEL_BY_MODEL: Readonly<Record<string, string>> = {
    'sd3.5-large': 'SD 3.5 Large**:',
    'sd3.5-large-turbo': 'SD 3.5 Large Turbo**:',
    'sd3.5-medium': 'SD 3.5 Medium**:',
    'sd3.5-flash': 'SD 3.5 Flash**:',
}

// Finds a credit count in the model property's own description, e.g.
// "`sd3.5-large` requires 6.5 credits per generation". Uses the shared
// boundary-safe locator (not a bare `indexOf`) because "sd3.5-large" is a
// real, confirmed text-prefix of "sd3.5-large-turbo" in this exact
// document - only the "-" now counting as a word character stops that
// bullet from being read as this model's.
const extractPropertyCredits = (description: string | undefined, vendorModel: string) => {
    if (!description) return undefined
    return findLabeledNumber(description, vendorModel, { withinChars: 60 })
}

// Finds a credit count in the operation's "### Credits" section using the
// reviewed heading label for `vendorModel` - never the bare slug, which
// that section never contains.
const extractOperationCredits = (description: string | undefined, vendorModel: string) => {
    const heading = CREDITS_HEADING_LABEL_BY_MODEL[vendorModel]
    if (!description || !heading) return undefined
    return findLabeledNumber(description, heading, { withinChars: 80 })
}

const extractSingleSentenceCredits = (description: string | undefined): string | undefined => {
    if (!description) return undefined
    const match = /uses\s+([0-9]+(?:\.[0-9]+)?)\s+credits?\s+per\s+successful\s+result/i.exec(description)
    return match?.[1]
}

// Adapts the `stability-api` route per the reviewed two-source design:
// credits come from Stability's public OpenAPI document (prose, not a
// numeric schema field - the operation description and the `model`
// property's description must agree on the model's credit count), and the
// USD-per-credit conversion comes from a same-origin module discovered from
// the official pricing page shell, downloaded as inert text and never
// executed. The final rate multiplies the two independently-evidenced
// inputs rather than storing one blended number.
export class StabilityPricingAdapter implements ProviderAdapter {
    readonly route = 'stability-api' as const

    async validate(candidate: PricingCandidate): Promise<ProviderValidationResult> {
        const { vendorModel } = candidate.record
        const endpoint = matchEndpoint(vendorModel)
        if (!endpoint) {
            return held('missing-upstream-entry', `No reviewed Stability endpoint mapping for vendor model ${vendorModel}`)
        }
        const [, path, kind] = endpoint

        const creditsResult = await this.resolveCredits(vendorModel, path, kind)
        if (creditsResult.status === 'held') return creditsResult
        const { credits, creditsLocator } = creditsResult

        const usdPerCreditResult = await this.resolveUsdPerCredit()
        if (usdPerCreditResult.status === 'held') return usdPerCreditResult
        const { usdPerCredit, usdLocator, moduleUrl } = usdPerCreditResult

        const observedAt = new Date().toISOString()
        const creditsInput: PriceDerivationInput = {
            inputId: 'creditsPerGeneration',
            value: credits,
            unit: 'credits/generation',
            evidence: [{
                mechanism: 'provider-openapi',
                sourceId: OPENAPI_URL,
                sourceLocators: [creditsLocator],
                parserVersion: PARSER_VERSION,
                observedAt,
            }],
        }
        const usdInput: PriceDerivationInput = {
            inputId: 'usdPerCredit',
            value: usdPerCredit,
            unit: 'USD/credit',
            evidence: [{
                mechanism: 'provider-doc',
                sourceId: moduleUrl,
                sourceLocators: [usdLocator],
                parserVersion: PARSER_VERSION,
                observedAt,
            }],
        }

        const amount = (Number(credits) * Number(usdPerCredit)).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
        const rate: PriceRate = {
            measuringUnit: 'credits',
            pricePer: '1',
            amount,
            derivation: {
                inputs: [creditsInput, usdInput],
                expression: {
                    operation: 'multiply',
                    operands: [
                        { operation: 'input', inputId: 'creditsPerGeneration' },
                        { operation: 'input', inputId: 'usdPerCredit' },
                    ],
                },
            },
        }

        const components = { imageOutput: rate }
        const variant: PriceVariant = {
            variantId: canonicalHash({ selectors: {}, components }),
            selectors: {},
            components,
        }

        return { status: 'verified', variants: [variant] }
    }

    private async resolveCredits(
        vendorModel: string,
        path: string,
        kind: EndpointKind,
    ): Promise<{ status: 'ok'; credits: string; creditsLocator: string } | { status: 'held'; reason: CandidateHoldReason; detail: string }> {
        const { text } = await fetchAllowlistedText({
            url: OPENAPI_URL,
            allowedOrigins: new Set([STABILITY_API_ORIGIN]),
            maxBytes: MAX_OPENAPI_BYTES,
        })

        let document: OpenApiDocument
        try {
            document = JSON.parse(text) as OpenApiDocument
        } catch {
            return { status: 'held', reason: 'provider-source-invalid', detail: 'Stability OpenAPI document is not valid JSON' }
        }

        const operation = document.paths?.[path]?.post
        if (!operation) {
            return { status: 'held', reason: 'provider-spec-inconsistent', detail: `OpenAPI document has no POST operation for ${path}` }
        }

        if (kind === 'single-model') {
            const credits = extractSingleSentenceCredits(operation.description)
            if (!credits) {
                return { status: 'held', reason: 'provider-spec-inconsistent', detail: `${path}'s description does not state a flat per-result credit count` }
            }
            return { status: 'ok', credits, creditsLocator: `${path} description: uses ${credits} credits per successful result` }
        }

        const schema = Object.values(operation.requestBody?.content ?? {})[0]?.schema
        const modelProperty = schema?.properties?.model
        if (!modelProperty?.enum?.includes(vendorModel)) {
            return { status: 'held', reason: 'provider-spec-inconsistent', detail: `${vendorModel} is absent from ${path}'s declared model enum` }
        }

        const operationCredits = extractOperationCredits(operation.description, vendorModel)
        const propertyCredits = extractPropertyCredits(modelProperty.description, vendorModel)
        if (!operationCredits || !propertyCredits) {
            return { status: 'held', reason: 'provider-spec-inconsistent', detail: `Could not locate a credit count for ${vendorModel} in both the operation's "### Credits" section and the model-property description` }
        }
        if (operationCredits.value !== propertyCredits.value) {
            return { status: 'held', reason: 'provider-spec-inconsistent', detail: `Operation "### Credits" section (${operationCredits.value} credits) disagrees with model-property description (${propertyCredits.value} credits) for ${vendorModel}` }
        }

        return {
            status: 'ok',
            credits: operationCredits.value,
            creditsLocator: `${path}: "${operationCredits.locator}" agrees with "${propertyCredits.locator}"`,
        }
    }

    private async resolveUsdPerCredit(): Promise<
        | { status: 'ok'; usdPerCredit: string; usdLocator: string; moduleUrl: string }
        | { status: 'held'; reason: CandidateHoldReason; detail: string }
    > {
        let shell: { text: string; resolvedUrl: string }
        try {
            shell = await fetchAllowlistedText({
                url: PRICING_PAGE_URL,
                allowedOrigins: new Set([PLATFORM_STABILITY_ORIGIN]),
                maxBytes: MAX_SHELL_BYTES,
            })
        } catch (error) {
            if (error instanceof ProviderSourceError) return { status: 'held', reason: error.reason, detail: error.message }
            throw error
        }

        const isChallenged = CHALLENGE_INDICATORS.some(indicator => shell.text.includes(indicator))

        // Only same-origin script sources are eligible; the module is
        // downloaded as inert text and never executed.
        const scriptSrcPattern = /<script[^>]+src="([^"]+)"/g
        const candidates = new Set<string>()
        let match: RegExpExecArray | null
        while ((match = scriptSrcPattern.exec(shell.text)) !== null) {
            try {
                const resolved = new URL(match[1]!, shell.resolvedUrl)
                if (resolved.origin === PLATFORM_STABILITY_ORIGIN) candidates.add(resolved.toString())
            } catch {
                // Ignore unparsable src attributes.
            }
        }

        if (candidates.size !== 1) {
            return isChallenged
                ? { status: 'held', reason: 'provider-source-challenged', detail: `Expected exactly one same-origin module asset; found ${candidates.size}, and challenge indicators were present` }
                : { status: 'held', reason: 'provider-layout-changed', detail: `Expected exactly one same-origin module asset; found ${candidates.size}` }
        }

        const moduleUrl = [...candidates][0]!
        let module: { text: string }
        try {
            module = await fetchAllowlistedText({
                url: moduleUrl,
                allowedOrigins: new Set([PLATFORM_STABILITY_ORIGIN]),
                maxBytes: MAX_MODULE_BYTES,
            })
        } catch (error) {
            if (error instanceof ProviderSourceError) return { status: 'held', reason: error.reason, detail: error.message }
            throw error
        }

        const creditStatement = findLabeledAmount(module.text, '1 credit = ', { withinChars: 20 })
        const gettingStartedMatch = /\$1 USD per 100 credits/.exec(module.text)
        if (!creditStatement || !gettingStartedMatch) {
            return { status: 'held', reason: 'provider-spec-inconsistent', detail: 'Module is missing one of the two required USD-per-credit statements' }
        }
        if (creditStatement.amount !== '0.01') {
            return { status: 'held', reason: 'provider-spec-inconsistent', detail: `"1 credit = $${creditStatement.amount}" disagrees with "$1 USD per 100 credits"` }
        }

        return { status: 'ok', usdPerCredit: '0.01', usdLocator: '"1 credit = $0.01" agrees with "$1 USD per 100 credits"', moduleUrl }
    }
}

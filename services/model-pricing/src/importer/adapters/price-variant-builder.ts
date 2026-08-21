'use strict'

import { canonicalHash } from '../canonical-json.ts'
import type {
    PriceComponentKind,
    PriceEvidence,
    PriceRate,
    PriceVariant,
    PricingDimensions,
} from '@lixpi/constants'

export type DirectRateComponentSpec = {
    measuringUnit: PriceRate['measuringUnit']
    pricePer: string
    amount: string
    inputId: string
    unit: string
    evidence: PriceEvidence[]
}

// Builds a PriceVariant whose components are each a single reviewed amount
// with a one-input `{ operation: 'input' }` derivation - the common case for
// provider docs that publish one flat rate per unit (Anthropic, Gemini, and
// OpenAI token/image pricing tables all fit this shape). Adapters whose rate
// is itself a product of two evidenced inputs (Stability's credits x
// usd-per-credit) build their PriceRate directly instead of using this.
export const buildDirectRateVariant = (
    selectors: PricingDimensions,
    components: Partial<Record<PriceComponentKind, DirectRateComponentSpec>>,
): PriceVariant => {
    const builtComponents: Partial<Record<PriceComponentKind, PriceRate>> = {}

    for (const kind of Object.keys(components) as PriceComponentKind[]) {
        const spec = components[kind]
        if (!spec) continue
        builtComponents[kind] = {
            measuringUnit: spec.measuringUnit,
            pricePer: spec.pricePer,
            amount: spec.amount,
            derivation: {
                inputs: [{ inputId: spec.inputId, value: spec.amount, unit: spec.unit, evidence: spec.evidence }],
                expression: { operation: 'input', inputId: spec.inputId },
            },
        }
    }

    return {
        variantId: canonicalHash({ selectors, components: builtComponents }),
        selectors,
        components: builtComponents,
    }
}

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { CapabilityActionRegistry } from '../../../backend/capability-action-registry.ts'
import {
    registerStyleExtractionActions,
    type StyleExtractionRuntimePort,
} from './style-extraction-actions.ts'

const runtime = (): StyleExtractionRuntimePort => ({
    initialize: vi.fn(),
    route: vi.fn(),
    extractAxis: vi.fn(),
    materializeSourceCrops: vi.fn(),
    synthesizeStyle: vi.fn(),
    generateSamples: vi.fn(),
    persistStyle: vi.fn(),
})

describe('Style Extraction package actions', () => {
    it('owns the complete action allowlist while delegating service work through one runtime port', () => {
        const registry = new CapabilityActionRegistry()

        registerStyleExtractionActions(registry, { runtime: runtime() })

        expect([...registry.allowedActionKeys()].sort()).toEqual([
            'style.extract-axis',
            'style.generate-samples',
            'style.initialize',
            'style.materialize-crops',
            'style.merge-analysis',
            'style.persist',
            'style.route',
            'style.synthesize',
            'visual-style.apply',
        ])
    })

    it('rejects invalid extractor concurrency before action registration', () => {
        const registry = new CapabilityActionRegistry()

        expect(() =>
            registerStyleExtractionActions(registry, {
                runtime: runtime(),
                extractorConcurrency: 0,
            })
        ).toThrow('Style extractor concurrency must be positive')
        expect(registry.allowedActionKeys().size).toBe(0)
    })
})

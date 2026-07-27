import { describe, expect, it } from 'vitest'

import {
    type CapabilityResourceRef,
} from '@lixpi/constants'
import { validateCapabilityManifest } from '@lixpi/capability-system/shared'

import {
    STYLE_EXTRACTION_AXES,
    buildStyleExtractionManifest,
} from './style-extraction-definition.ts'

const inputSchema: CapabilityResourceRef = {
    resourceId: 'input',
    blobHash: 'input-hash',
    mediaType: 'application/schema+json',
    role: 'schema',
}

const outputSchema: CapabilityResourceRef = {
    resourceId: 'output',
    blobHash: 'output-hash',
    mediaType: 'application/schema+json',
    role: 'schema',
}

describe('Style Extraction built-in definition', () => {
    it('defines a valid allowlisted workflow with every registered specialist axis', () => {
        const manifest = buildStyleExtractionManifest({ inputSchema, outputSchema })
        const actions = new Set([
            'style.initialize',
            'style.route',
            'style.extract-axis',
            'style.materialize-crops',
            'style.merge-analysis',
            'style.synthesize',
            'style.generate-samples',
            'style.persist',
        ])

        expect(validateCapabilityManifest(manifest, { allowedActions: actions })).toEqual({
            valid: true,
            manifest,
            issues: [],
        })
        expect(manifest.tool?.workflow.steps
            .filter(step => step.action === 'style.extract-axis')
            .map(step => step.input.axis)).toEqual(STYLE_EXTRACTION_AXES.map(axis => ({
            source: 'literal',
            value: axis,
        })))
        expect(manifest.tool?.workflow.steps
            .filter(step => step.action === 'style.extract-axis')
            .every(step => step.condition?.type === 'compare')).toBe(true)
    })

    it('keeps axis extraction and crop materialization in the same parallel ready set', () => {
        const steps = buildStyleExtractionManifest({ inputSchema, outputSchema }).tool!.workflow.steps
        const axisSteps = steps.filter(step => step.action === 'style.extract-axis')
        const crops = steps.find(step => step.action === 'style.materialize-crops')!
        const merge = steps.find(step => step.action === 'style.merge-analysis')!

        expect(axisSteps).toHaveLength(STYLE_EXTRACTION_AXES.length)
        expect(axisSteps.every(step => step.dependsOn.join(',') === 'route')).toBe(true)
        expect(crops.dependsOn).toEqual(['route'])
        expect(merge.dependsOn).toEqual([
            ...axisSteps.map(step => step.stepId),
            'materialize-crops',
        ])
    })
})

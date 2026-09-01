'use strict'

import { readFileSync } from 'node:fs'

import {
    describe,
    expect,
    it,
} from 'vitest'

const expectSourceToContain = (source: string, snippet: string, label: string): void => {
    expect(source.includes(snippet), `${label} should contain:\n${snippet}`).toBe(true)
}

const expectSourceNotToContain = (source: string, snippet: string, label: string): void => {
    expect(source.includes(snippet), `${label} should not contain:\n${snippet}`).toBe(false)
}

describe('AssetDocumentService settlement scheduling', () => {
    it('uses one keyed idle scheduler instead of arming a timer for every accepted step batch', () => {
        const source = readFileSync(new URL('./asset-document-service.ts', import.meta.url), 'utf8')
        const submitStepsStart = source.indexOf('    submitSteps: async ({')
        const submitStepsEnd = source.indexOf('    resume: async ({', submitStepsStart)
        const submitSteps = source.slice(submitStepsStart, submitStepsEnd)

        expect(submitStepsStart, 'submitSteps implementation should exist').toBeGreaterThanOrEqual(0)
        expect(submitStepsEnd, 'resume implementation should follow submitSteps').toBeGreaterThan(submitStepsStart)
        expectSourceToContain(
            submitSteps,
            'assetDocumentSettlementScheduler.schedule(',
            'submitSteps implementation',
        )
        expectSourceNotToContain(submitSteps, 'setTimeout(', 'submitSteps implementation')
    })
})

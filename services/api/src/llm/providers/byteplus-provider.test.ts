'use strict'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BytePlusProvider } from './byteplus-provider.ts'

// Construction only builds the LangGraph workflow (no deps are touched), so a
// bare cast is enough to exercise the API-key guard + providerName.
const noopDeps = {} as any

describe('BytePlusProvider', () => {
    const prevByteplus = process.env.BYTEPLUS_ARK_API_KEY
    const prevArk = process.env.ARK_API_KEY

    beforeEach(() => {
        delete process.env.BYTEPLUS_ARK_API_KEY
        delete process.env.ARK_API_KEY
    })

    afterEach(() => {
        if (prevByteplus === undefined) delete process.env.BYTEPLUS_ARK_API_KEY
        else process.env.BYTEPLUS_ARK_API_KEY = prevByteplus
        if (prevArk === undefined) delete process.env.ARK_API_KEY
        else process.env.ARK_API_KEY = prevArk
    })

    it('constructs with BYTEPLUS_ARK_API_KEY and reports providerName BytePlus', () => {
        process.env.BYTEPLUS_ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws:thread:video', noopDeps)
        expect(provider.providerName).toBe('BytePlus')
    })

    it('falls back to ARK_API_KEY', () => {
        process.env.ARK_API_KEY = 'test-key'
        const provider = new BytePlusProvider('ws:thread:video', noopDeps)
        expect(provider.providerName).toBe('BytePlus')
    })

    it('throws a clear error when no API key is configured', () => {
        expect(() => new BytePlusProvider('ws:thread:video', noopDeps)).toThrow(/ARK_API_KEY/)
    })
})

import { describe, expect, it } from 'vitest'

import {
    acceptCapabilityJsonValue,
    CapabilityActionRegistry,
    type CapabilityActionDefinition,
} from './capability-action-registry.ts'
import { isCapabilityError } from '../shared/capability-errors.ts'

function makeAction(overrides: Partial<CapabilityActionDefinition> & { key: string }): CapabilityActionDefinition {
    return {
        timeoutMs: 1000,
        validateInput: () => ({ valid: true }),
        validateOutput: () => ({ valid: true }),
        authorize: () => true,
        execute: async () => ({}),
        classifyRetry: () => 'terminal',
        ...overrides,
    }
}

describe('CapabilityActionRegistry — register', () => {
    it('registers an action addressable by get/has', () => {
        const registry = new CapabilityActionRegistry()
        const definition = makeAction({ key: 'style-extraction.run' })

        registry.register(definition)

        expect(registry.has('style-extraction.run')).toBe(true)
        expect(registry.get('style-extraction.run')).toMatchObject({ key: 'style-extraction.run' })
    })

    it('freezes the stored definition so callers cannot mutate registry state', () => {
        const registry = new CapabilityActionRegistry()
        registry.register(makeAction({ key: 'style-extraction.run' }))

        const stored = registry.get('style-extraction.run')

        expect(Object.isFrozen(stored)).toBe(true)
    })

    it('rejects a key with fewer than two dot-separated segments', () => {
        const registry = new CapabilityActionRegistry()

        expect(() => registry.register(makeAction({ key: 'run' })))
            .toThrow('Capability action key run is invalid')
    })

    it.each([
        'Style-Extraction.run',
        'style_extraction.run',
        'style-extraction.Run',
        '.run',
        'style-extraction.',
        '-style.run',
    ])('rejects invalid key shape %s', (key) => {
        const registry = new CapabilityActionRegistry()

        expect(() => registry.register(makeAction({ key })))
            .toThrow(`Capability action key ${key} is invalid`)
    })

    it('accepts a key with more than two segments', () => {
        const registry = new CapabilityActionRegistry()

        expect(() => registry.register(makeAction({ key: 'style-extraction.pipeline.run' }))).not.toThrow()
    })

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects a non-positive-integer timeoutMs of %s',
        (timeoutMs) => {
            const registry = new CapabilityActionRegistry()

            expect(() => registry.register(makeAction({ key: 'style-extraction.run', timeoutMs })))
                .toThrow('must have a positive integer timeout')
        },
    )

    it('rejects re-registering an already-registered key', () => {
        const registry = new CapabilityActionRegistry()
        registry.register(makeAction({ key: 'style-extraction.run' }))

        expect(() => registry.register(makeAction({ key: 'style-extraction.run' })))
            .toThrow('Capability action style-extraction.run is already registered')
    })

    it('raises a CapabilityError with the expected error code on invalid registration', () => {
        const registry = new CapabilityActionRegistry()

        try {
            registry.register(makeAction({ key: 'run' }))
            expect.unreachable('registration should have thrown')
        } catch (error) {
            expect(isCapabilityError(error)).toBe(true)
            expect((error as { code: string }).code).toBe('CAPABILITY_WORKFLOW_INVALID')
        }
    })
})

describe('CapabilityActionRegistry — get/has/allowedActionKeys', () => {
    it('throws CAPABILITY_ACTION_NOT_ALLOWED for an unregistered key', () => {
        const registry = new CapabilityActionRegistry()

        try {
            registry.get('missing.action')
            expect.unreachable('get should have thrown')
        } catch (error) {
            expect(isCapabilityError(error)).toBe(true)
            expect((error as { code: string }).code).toBe('CAPABILITY_ACTION_NOT_ALLOWED')
        }
    })

    it('reports has() as false for an unregistered key', () => {
        const registry = new CapabilityActionRegistry()

        expect(registry.has('missing.action')).toBe(false)
    })

    it('lists every registered key exactly once via allowedActionKeys', () => {
        const registry = new CapabilityActionRegistry()
        registry.register(makeAction({ key: 'style-extraction.run' }))
        registry.register(makeAction({ key: 'character-creator.run' }))

        const keys = registry.allowedActionKeys()

        expect(keys).toEqual(new Set(['style-extraction.run', 'character-creator.run']))
    })

    it('returns a snapshot from allowedActionKeys that does not track later registrations', () => {
        const registry = new CapabilityActionRegistry()
        registry.register(makeAction({ key: 'style-extraction.run' }))

        const keys = registry.allowedActionKeys()
        registry.register(makeAction({ key: 'character-creator.run' }))

        expect(keys).toEqual(new Set(['style-extraction.run']))
    })
})

describe('acceptCapabilityJsonValue', () => {
    it.each([
        null,
        'text',
        true,
        false,
        0,
        -3.5,
        [1, 'two', [3, false]],
        { a: 1, b: { c: [null, 'x'] } },
    ])('accepts JSON-compatible value %j', (value) => {
        expect(acceptCapabilityJsonValue(value)).toEqual({ valid: true })
    })

    it('rejects undefined', () => {
        expect(acceptCapabilityJsonValue(undefined)).toEqual({
            valid: false,
            message: 'Value must be JSON-compatible',
        })
    })

    it('rejects non-finite numbers', () => {
        expect(acceptCapabilityJsonValue(Number.NaN)).toEqual({ valid: false, message: 'Value must be JSON-compatible' })
        expect(acceptCapabilityJsonValue(Number.POSITIVE_INFINITY)).toEqual({
            valid: false,
            message: 'Value must be JSON-compatible',
        })
    })

    it('rejects functions and symbols nested inside objects', () => {
        expect(acceptCapabilityJsonValue({ fn: () => {} })).toEqual({
            valid: false,
            message: 'Value must be JSON-compatible',
        })
    })

    it('rejects an array containing a non-JSON value', () => {
        expect(acceptCapabilityJsonValue([1, undefined, 3])).toEqual({
            valid: false,
            message: 'Value must be JSON-compatible',
        })
    })

    it.each(['__proto__', 'prototype', 'constructor'])(
        'rejects an object with an unsafe property key %s',
        (key) => {
            const value = JSON.parse(`{"${key}": 1}`)
            expect(acceptCapabilityJsonValue(value)).toEqual({
                valid: false,
                message: 'Value must be JSON-compatible',
            })
        },
    )
})

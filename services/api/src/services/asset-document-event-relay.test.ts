import { readFileSync } from 'node:fs'

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'

import { AssetDocumentEventAuthorizationCache } from './asset-document-event-relay.ts'

// These assertions pin down what the source does, not how the formatter lays it out.
// Line breaks and trailing commas are the formatter's choice and change nothing about
// the behavior, so both sides are compared on tokens alone.
const withoutLayout = (value: string): string => value
    .replace(/\s+/g, '')
    .replace(/,(?=[)\]}])/g, '')
    .replace(/,$/, '')

const expectSourceToContain = (source: string, snippet: string, label: string): void => {
    expect(withoutLayout(source).includes(withoutLayout(snippet)), `${label} should contain:\n${snippet}`).toBe(true)
}

const expectSourceNotToContain = (source: string, snippet: string, label: string): void => {
    expect(withoutLayout(source).includes(withoutLayout(snippet)), `${label} should not contain:\n${snippet}`).toBe(false)
}

describe('AssetDocumentEventAuthorizationCache', () => {
    it('does not reauthorize for every event inside the refresh interval', async () => {
        const refresh = vi.fn(async () => true)
        const authorization = new AssetDocumentEventAuthorizationCache({
            authorized: true,
            refreshedAt: 0,
        })

        for (let event = 0; event < 601; event += 1) {
            await expect(authorization.authorize({ now: 4999, refresh })).resolves.toEqual({
                authorized: true,
                refreshed: false,
            })
        }

        expect(refresh).not.toHaveBeenCalled()
    })

    it('performs one refresh when stale and caches that decision for following events', async () => {
        const refresh = vi.fn(async () => true)
        const authorization = new AssetDocumentEventAuthorizationCache({
            authorized: true,
            refreshedAt: 0,
        })

        await expect(authorization.authorize({ now: 5000, refresh })).resolves.toEqual({
            authorized: true,
            refreshed: true,
        })
        for (let event = 0; event < 601; event += 1) {
            await authorization.authorize({ now: 5000, refresh })
        }

        expect(refresh).toHaveBeenCalledOnce()
    })

    it('fails closed after a denied refresh until a validated resume confirms access', async () => {
        const authorization = new AssetDocumentEventAuthorizationCache({
            authorized: true,
            refreshedAt: 0,
        })

        await expect(authorization.authorize({
            now: 5000,
            refresh: async () => false,
        })).resolves.toEqual({ authorized: false, refreshed: true })
        await expect(authorization.authorize({
            now: 5001,
            refresh: async () => true,
        })).resolves.toEqual({ authorized: false, refreshed: false })

        authorization.confirmAuthorized(5001)
        await expect(authorization.authorize({
            now: 5001,
            refresh: async () => false,
        })).resolves.toEqual({ authorized: true, refreshed: false })
    })

    it('keeps Asset reads out of the per-event forwarding loop', () => {
        const source = readFileSync(new URL('./asset-document-event-relay.ts', import.meta.url), 'utf8')
        const loopStart = source.indexOf('for await (const message of subscription)')
        const loopEnd = source.indexOf('        } finally {', loopStart)
        const eventLoop = source.slice(loopStart, loopEnd)

        expect(loopStart, 'event relay loop should exist').toBeGreaterThanOrEqual(0)
        expect(loopEnd, 'event relay loop should have an outer finally block').toBeGreaterThan(loopStart)
        expectSourceToContain(eventLoop, 'relay.authorization.authorize', 'event relay loop')
        expectSourceNotToContain(eventLoop, 'AssetModel.get', 'event relay loop')
    })
})

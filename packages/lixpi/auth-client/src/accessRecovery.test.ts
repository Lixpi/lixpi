import { describe, expect, it, vi } from 'vitest'
import { AccessRecovery } from './accessRecovery.ts'

describe('account access recovery', () => {
    it('allows one uncached retry, then closes once even when several requests fail', async () => {
        const auth = {
            getTokenSilently: vi.fn(async () => 'fresh-token'),
            rejectAccess: vi.fn(async () => {}),
        }
        const cleanup = vi.fn(async () => {})
        const recovery = new AccessRecovery(auth, cleanup, vi.fn())
        await expect(recovery.authError()).resolves.toBeUndefined()
        expect(auth.getTokenSilently).toHaveBeenCalledWith(true)
        await expect(recovery.authError()).resolves.toBe(false)
        recovery.deny()
        await recovery.authError()
        expect(auth.getTokenSilently).toHaveBeenCalledOnce()
        expect(auth.rejectAccess).toHaveBeenCalledExactlyOnceWith(cleanup)
    })

    it('resets the retry allowance on a successful connection and rejects a failed refresh', async () => {
        const auth = {
            getTokenSilently: vi.fn<() => Promise<string | false>>().mockResolvedValue('fresh'),
            rejectAccess: vi.fn(async () => {}),
        }
        const recovery = new AccessRecovery(auth, async () => {}, vi.fn())
        await recovery.authError()
        recovery.connected()
        await recovery.authError()
        expect(auth.getTokenSilently).toHaveBeenCalledTimes(2)
        recovery.connected()
        auth.getTokenSilently.mockResolvedValue(false)
        await expect(recovery.authError()).resolves.toBe(false)
        expect(auth.rejectAccess).toHaveBeenCalledOnce()
    })
})

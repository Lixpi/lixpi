import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import {
    ACCESS_RETRY_WINDOW_MS,
    AccessRecovery,
    UNCACHED_TOKEN_AFTER_MS,
} from './accessRecovery.ts'

afterEach(() => void vi.useRealTimers())

const createAuth = () => ({
    getTokenSilently: vi.fn<(forceRefresh?: boolean) => Promise<string | false>>().mockResolvedValue('token'),
    rejectAccess: vi.fn(async () => {}),
})

describe('account access recovery', () => {
    it('retries a restarting service with the cached token', async () => {
        vi.useFakeTimers()
        const auth = createAuth()
        const recovery = new AccessRecovery(auth, async () => {}, vi.fn())

        for (let attempt = 0; attempt < 4; attempt++) {
            await expect(recovery.authError()).resolves.toBeUndefined()
            vi.advanceTimersByTime(1000)
        }

        expect(auth.getTokenSilently.mock.calls.every(([forceRefresh]) => forceRefresh === false)).toBe(true)
        expect(auth.rejectAccess).not.toHaveBeenCalled()
    })

    it('fetches one uncached token once rejections outlast a restart', async () => {
        vi.useFakeTimers()
        const auth = createAuth()
        const recovery = new AccessRecovery(auth, async () => {}, vi.fn())
        await recovery.authError()
        vi.advanceTimersByTime(UNCACHED_TOKEN_AFTER_MS)

        await recovery.authError()
        vi.advanceTimersByTime(1000)
        await recovery.authError()

        expect(auth.getTokenSilently.mock.calls.map(([forceRefresh]) => forceRefresh)).toEqual([false, true, false])
        expect(auth.rejectAccess).not.toHaveBeenCalled()
    })

    it('rejects the session once rejections outlast the retry window, even when several requests fail', async () => {
        vi.useFakeTimers()
        const auth = createAuth()
        const cleanup = vi.fn(async () => {})
        const recovery = new AccessRecovery(auth, cleanup, vi.fn())
        await recovery.authError()
        vi.advanceTimersByTime(ACCESS_RETRY_WINDOW_MS)

        await expect(recovery.authError()).resolves.toBe(false)
        recovery.deny()
        await expect(recovery.authError()).resolves.toBe(false)
        expect(auth.rejectAccess).toHaveBeenCalledExactlyOnceWith(cleanup)
    })

    it('starts over after a successful connection', async () => {
        vi.useFakeTimers()
        const auth = createAuth()
        const recovery = new AccessRecovery(auth, async () => {}, vi.fn())
        await recovery.authError()
        vi.advanceTimersByTime(UNCACHED_TOKEN_AFTER_MS)
        await recovery.authError()
        recovery.connected()
        vi.advanceTimersByTime(ACCESS_RETRY_WINDOW_MS)

        await expect(recovery.authError()).resolves.toBeUndefined()
        vi.advanceTimersByTime(UNCACHED_TOKEN_AFTER_MS)
        await recovery.authError()
        expect(auth.getTokenSilently.mock.calls.map(([forceRefresh]) => forceRefresh)).toEqual([false, true, false, true])
        expect(auth.rejectAccess).not.toHaveBeenCalled()
    })

    it('rejects the session when no token can be obtained', async () => {
        const auth = createAuth()
        auth.getTokenSilently.mockResolvedValue(false)
        const recovery = new AccessRecovery(auth, async () => {}, vi.fn())

        await expect(recovery.authError()).resolves.toBe(false)
        expect(auth.rejectAccess).toHaveBeenCalledOnce()
    })
})

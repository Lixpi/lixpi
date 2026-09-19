import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NatsRegistrationClient } from './registration.ts'

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    request: vi.fn(),
    close: vi.fn(),
}))
vi.mock('@nats-io/transport-node', () => ({ connect: mocks.connect }))
const options = {
    servers: ['nats://test'],
    password: 'bootstrap',
    registration: JSON.stringify({
        issuer: 'public',
        payload: 'signed',
        signature: 'signature',
    }),
}
beforeEach(() => {
    vi.resetAllMocks()
    mocks.connect.mockResolvedValue({
        request: mocks.request,
        close: mocks.close,
    })
})
describe('restricted registration delivery', () => {
    it('retries compare-and-swap conflicts and closes its bootstrap connection', async () => {
        mocks.request.mockResolvedValueOnce({ json: () => ({
            revision: 7,
            error: 'registration revision conflict',
        }) })
        mocks.request.mockResolvedValueOnce({ json: () => ({ revision: 8 }) })
        await NatsRegistrationClient.apply(options)
        expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({
            user: 'registration',
            inboxPrefix: '_REGISTRATION_REPLY',
            reconnect: false,
        }))
        expect(JSON.parse(mocks.request.mock.calls[1][1]).expectedRevision).toBe(7)
        expect(mocks.close).toHaveBeenCalledOnce()
    })
    it.each([{ error: 'invalid signature' }, {}, { revision: -1 }])('rejects invalid responses: %j', async response => {
        mocks.request.mockResolvedValue({ json: () => response })
        await expect(NatsRegistrationClient.apply(options)).rejects.toThrow('registration rejected')
        expect(mocks.close).toHaveBeenCalledOnce()
    })
    it('does not connect without approved declarations', async () => {
        await expect(NatsRegistrationClient.apply({
            ...options,
            registration: '',
        })).rejects.toThrow('required')
        expect(mocks.connect).not.toHaveBeenCalled()
    })
})

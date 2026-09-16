import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import jsonWebToken from 'jsonwebtoken'
import NatsService from '@lixpi/nats-service'
import {
    getNatsUserInboxPrefix,
    NATS_SUBJECTS,
} from '@lixpi/constants'

vi.mock('@lixpi/debug-tools', () => ({
    log: vi.fn(),
    info: vi.fn(),
    infoStr: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
}))

// =============================================================================
// Opt-in verification against the local API, NATS cluster, and LocalAuth0
// =============================================================================

describe.runIf(process.env.LIXPI_NATS_RUNTIME_TEST === 'true')('local NATS authentication', () => {
    it('rejects bad connection credentials, authenticates a user, and enforces request tokens', async () => {
        expect(process.env.VITE_MOCK_AUTH).toBe('true')
        const servers = ['nats://lixpi-nats-1:4222']

        await expect(NatsService.init({
            servers,
            token: 'invalid-runtime-test-token',
            initialConnectMaxAttempts: 1,
        })).rejects.toThrow()

        const tokenResponse = await fetch('http://lixpi-localauth0:3000/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: 'client_id',
                client_secret: 'client_secret',
                audience: process.env.VITE_AUTH0_AUDIENCE,
                grant_type: 'client_credentials',
            }),
            signal: AbortSignal.timeout(5000),
        })
        expect(tokenResponse.status).toBe(200)
        const { access_token: token } = await tokenResponse.json()
        expect(Boolean(token)).toBe(true)
        const claims = jsonWebToken.decode(token, { json: true })
        expect(typeof claims?.sub).toBe('string')

        const service = await NatsService.init({
            servers,
            name: 'api-auth-runtime-test',
            token,
            inboxPrefix: getNatsUserInboxPrefix(claims!.sub!),
            initialConnectMaxAttempts: 1,
        })

        try {
            expect(service.isConnected()).toBe(true)

            const missingTokenReply = await service.request(NATS_SUBJECTS.USER_SUBJECTS.GET_USER, {})
            expect(missingTokenReply).toEqual({ error: 'Authentication required' })

            const invalidTokenReply = await service.request(NATS_SUBJECTS.USER_SUBJECTS.GET_USER, { token: 'invalid-runtime-test-token' })
            expect(invalidTokenReply).toEqual({ error: 'Authentication failed: Invalid or expired token' })

            const user = await service.request(NATS_SUBJECTS.USER_SUBJECTS.GET_USER, { token })
            expect(user.userId).toBe(claims!.sub)
        } finally {
            await service.disconnect()
        }
    }, 20000)
})

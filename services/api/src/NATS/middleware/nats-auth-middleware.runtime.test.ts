import {
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import jsonWebToken from 'jsonwebtoken'
import {
    createHash,
    randomUUID,
} from 'node:crypto'
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
    it('serves the login loader and its intact JavaScript and WebAssembly resources', async () => {
        const origin = 'http://lixpi-localauth0:3000'
        const response = await fetch(`${origin}/authorize`, { signal: AbortSignal.timeout(5000) })
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html.includes('<script type="module">')).toBe(true)
        const resources = [...html.matchAll(/<link\b[^>]*>/g)]
            .map(match => match[0])
            .filter(link => /rel="(?:modulepreload|preload)"/.test(link))

        expect(resources.some(link => link.includes('.wasm'))).toBe(true)
        expect(resources.some(link => link.includes('.js'))).toBe(true)

        for (const link of resources) {
            const path = link.match(/href="([^"]+)"/)?.[1]
            const integrity = link.match(/integrity="([^"]+)"/)?.[1]
            expect(path?.startsWith('/')).toBe(true)
            const asset = await fetch(new URL(path!, origin), { signal: AbortSignal.timeout(5000) })
            expect(asset.status).toBe(200)
            const bytes = new Uint8Array(await asset.arrayBuffer())
            expect(`sha384-${createHash('sha384').update(bytes).digest('base64')}`).toBe(integrity)

            if (path!.endsWith('.wasm')) {
                expect(asset.headers.get('content-type')).toMatch(/application\/wasm/)
                expect(WebAssembly.validate(bytes)).toBe(true)
            } else
                expect(asset.headers.get('content-type')).toMatch(/javascript/)
        }
    })

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
        expect(claims?.sub).toBe('local|test-user-001')
        expect(claims?.email_verified).toBe(true)
        expect(claims?.['https://lixpi.ai/admission']).toEqual({
            v: 1,
            epoch: 1,
        })

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
            expect(Array.isArray(user.organizations)).toBe(true)
            expect(user.organizations.length).toBeGreaterThan(0)

            const workspaces = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_USER_WORKSPACES, { token })
            expect(Array.isArray(workspaces)).toBe(true)

            const name = `Local startup verification ${randomUUID()}`
            const workspace = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.CREATE_WORKSPACE, {
                token,
                name,
            })
            expect(typeof workspace.workspaceId).toBe('string')

            try {
                const loaded = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                })
                expect(loaded.name).toBe(name)
                expect(loaded.organizationId).toBe(user.organizations[0])

                const updated = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.UPDATE_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                    name: `${name} updated`,
                })
                expect(updated.success).toBe(true)
                const reloaded = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.GET_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                })
                expect(reloaded.name).toBe(`${name} updated`)
            } finally {
                const deleted = await service.request(NATS_SUBJECTS.WORKSPACE_SUBJECTS.DELETE_WORKSPACE, {
                    token,
                    workspaceId: workspace.workspaceId,
                })
                expect(deleted.success).toBe(true)
            }
        } finally {
            await service.disconnect()
        }
    }, 20000)
})

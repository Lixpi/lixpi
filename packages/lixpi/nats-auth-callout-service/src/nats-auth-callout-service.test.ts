import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const {
    decodeMock,
    fromSeedMock,
    fromPublicMock,
    encodeUserMock,
    encodeAuthorizationResponseMock,
    createJwtVerifierMock,
    verifyNKeySignedJWTMock,
    debugInfoMock,
    debugErrorMock,
} = vi.hoisted(() => ({
    decodeMock: vi.fn(),
    fromSeedMock: vi.fn(),
    fromPublicMock: vi.fn(),
    encodeUserMock: vi.fn(),
    encodeAuthorizationResponseMock: vi.fn(),
    createJwtVerifierMock: vi.fn(),
    verifyNKeySignedJWTMock: vi.fn(),
    debugInfoMock: vi.fn(),
    debugErrorMock: vi.fn(),
}))

vi.mock('jsonwebtoken', () => ({
    default: {
        decode: decodeMock,
    },
}))

vi.mock('@nats-io/nkeys', () => ({
    fromSeed: (...args: any[]) => fromSeedMock(...args),
    fromPublic: (...args: any[]) => fromPublicMock(...args),
}))

vi.mock('@nats-io/jwt', () => ({
    encodeUser: (...args: any[]) => encodeUserMock(...args),
    encodeAuthorizationResponse: (...args: any[]) => encodeAuthorizationResponseMock(...args),
}))

vi.mock('@lixpi/auth-service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@lixpi/auth-service')>()
    return {
        ...actual,
        createJwtVerifier: createJwtVerifierMock,
        verifyNKeySignedJWT: (...args: any[]) => verifyNKeySignedJWTMock(...args),
    }
})

vi.mock('@lixpi/debug-tools', () => ({
    info: (...args: any[]) => debugInfoMock(...args),
    err: (...args: any[]) => debugErrorMock(...args),
}))

import { startNatsAuthCalloutService } from './nats-auth-callout-service.ts'

type MockNatsService = {
    reply: ReturnType<typeof vi.fn>
}

type MockRequestMessage = {
    data: Uint8Array
    headers: {
        get: (name: string) => string | undefined
    }
}

const auth0User = 'user:regular'
const rawServiceUser = 'svc:nats-worker'
const rawServicePublicKey = 'UA-RAW-SERVICE'
const natsServicePublicKey = 'NKEY-USER'
const serverId = 'server-123'
const requestNonce = 'nonce-from-server'
const challengeSignature = 'aGVsbG8'

const buildAuthRequest = (request: Record<string, any>): MockRequestMessage => ({
    data: new TextEncoder().encode(JSON.stringify(request)),
    headers: {
        get: (name: string) => name === 'Nats-Server-Xkey' ? 'CURVE_PUBLIC_KEY' : undefined,
    },
})

const extractEncodedPermissions = (calls: any[]) => {
    return calls[0]?.[3]
}

describe('startNatsAuthCalloutService', () => {
    let authorizationRequestCurveKeyPair: { open: ReturnType<typeof vi.fn> }
    let authorizationIssuerKeyPair: { getPublicKey: ReturnType<typeof vi.fn> }
    let rawNKeyVerifier: { verify: ReturnType<typeof vi.fn> }

    let auth0JwtVerifier = { verify: () => Promise.reject(new Error('not configured')) }
    let natsServiceMock: MockNatsService
    let authCalloutCallback: ((payload: any, requestMessage: MockRequestMessage) => Promise<string>) | null

    beforeEach(() => {
        vi.clearAllMocks()

        authorizationIssuerKeyPair = {
            getPublicKey: vi.fn().mockReturnValue('NKEY-ISSUER'),
        }
        authorizationRequestCurveKeyPair = {
            open: vi.fn(),
        }
        rawNKeyVerifier = {
            verify: vi.fn(),
        }

        fromSeedMock.mockImplementation((seed: Buffer) => {
            const seedValue = seed.toString()
            if (seedValue === 'nKeyIssuerSeed') return authorizationIssuerKeyPair
            if (seedValue === 'xKeyIssuerSeed') return authorizationRequestCurveKeyPair
            return { getPublicKey: vi.fn().mockReturnValue('NKEY-UNKNOWN'), sign: vi.fn() }
        })

        fromPublicMock.mockReturnValue(rawNKeyVerifier)

        auth0JwtVerifier = {
            verify: vi.fn().mockResolvedValue({ decoded: { sub: auth0User } }),
        }
        createJwtVerifierMock.mockReturnValue(auth0JwtVerifier)

        verifyNKeySignedJWTMock.mockResolvedValue({ decoded: { sub: rawServiceUser } })
        verifyNKeySignedJWTMock.mockClear()
        encodeUserMock.mockReturnValue('SIGNED-USER-JWT')
        encodeAuthorizationResponseMock.mockReturnValue('SIGNED-AUTH-RESPONSE')

        authCalloutCallback = null
        natsServiceMock = {
            reply: vi.fn((...args: any[]) => {
                authCalloutCallback = args[1]
            }),
        }

        decodeMock.mockImplementation((value: any, options: any) => {
            if (options?.complete) {
                return { payload: { iss: '' } }
            }
            if (options?.json) {
                return JSON.parse(new TextDecoder().decode(value))
            }
            return null
        })

        authorizationRequestCurveKeyPair.open.mockImplementation((data: Uint8Array) => data)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.clearAllTimers()
    })

    it('throws when NATS auth signer seed is not provided', async () => {
        await expect(startNatsAuthCalloutService({
            natsService: natsServiceMock as unknown as any,
            subscriptions: [],
            nKeyIssuerSeed: '',
            xKeyIssuerSeed: 'xKeyIssuerSeed',
            jwtAudience: 'aud',
            jwtIssuer: 'iss',
            jwksUri: 'https://example.com/jwks',
            natsAuthAccount: 'AUTH',
        })).rejects.toThrow('Issuer seed for NATS auth callout not provided!')
    })

    it('throws when auth-callout XKey seed is not provided', async () => {
        await expect(startNatsAuthCalloutService({
            natsService: natsServiceMock as unknown as any,
            subscriptions: [],
            nKeyIssuerSeed: 'nKeyIssuerSeed',
            xKeyIssuerSeed: '',
            jwtAudience: 'aud',
            jwtIssuer: 'iss',
            jwksUri: 'https://example.com/jwks',
            natsAuthAccount: 'AUTH',
        })).rejects.toThrow('xKeyIssuerSeed for NATS auth callout not provided!')
    })

    it('authenticates regular users from Auth0 token and deduplicates expanded permissions', async () => {
        const request = {
            nats: {
                request_nonce: requestNonce,
                server_id: { id: serverId },
                user_nkey: natsServicePublicKey,
                connect_opts: {
                    auth_token: 'auth0-token',
                },
            },
        }
        decodeMock.mockImplementation((value: any, options: any) => {
            if (options?.complete) return { payload: { iss: '' } }
            if (options?.json) return request
            return null
        })

        const subscriptions = [
            {
                permissions: {
                    pub: { allow: ['workspace.{userId}.write', 'workspace.{userId}.write', '_INBOX.>'] },
                    sub: { allow: ['notify.{userId}', 'notify.{userId}.done'] },
                },
            },
            {
                permissions: {
                    pub: { allow: ['chat.broadcast'] },
                    sub: { allow: ['notify.{userId}'] },
                },
            },
        ]

        await startNatsAuthCalloutService({
            natsService: natsServiceMock as unknown as any,
            subscriptions,
            nKeyIssuerSeed: 'nKeyIssuerSeed',
            xKeyIssuerSeed: 'xKeyIssuerSeed',
            jwtAudience: 'aud',
            jwtIssuer: 'iss',
            jwksUri: 'https://example.com/jwks',
            natsAuthAccount: 'AUTH',
        })

        expect(authCalloutCallback).not.toBeNull()
        expect(natsServiceMock.reply).toHaveBeenCalledWith('$SYS.REQ.USER.AUTH', expect.any(Function), {}, 'buffer')

        const response = await authCalloutCallback!(undefined as never, buildAuthRequest(request))
        expect(response).toBe('SIGNED-AUTH-RESPONSE')
        expect(verifyNKeySignedJWTMock).not.toHaveBeenCalled()

        const permissions = extractEncodedPermissions(encodeUserMock.mock.calls)
        expect(permissions).toEqual({
            pub: { allow: ['_INBOX.>', 'workspace.user:regular.write', 'chat.broadcast'] },
            sub: { allow: ['_INBOX.>', 'notify.user:regular', 'notify.user:regular.done'] },
            type: 'user',
            version: 2,
        })
        expect(encodeAuthorizationResponseMock).toHaveBeenCalledWith(
            natsServicePublicKey,
            serverId,
            'NKEY-ISSUER',
            {
                jwt: 'SIGNED-USER-JWT',
                type: 'auth_response',
                version: 2,
            },
            {
                signer: authorizationIssuerKeyPair,
            },
        )
        expect(encodeUserMock).toHaveBeenCalledWith(
            auth0User,
            natsServicePublicKey,
            authorizationIssuerKeyPair,
            expect.objectContaining({
                pub: {
                    allow: ['_INBOX.>', 'workspace.user:regular.write', 'chat.broadcast'],
                },
                sub: {
                    allow: ['_INBOX.>', 'notify.user:regular', 'notify.user:regular.done'],
                },
            }),
            { aud: 'AUTH' },
        )
    })

    it('authenticates service clients through self-issued service JWT path', async () => {
        const request = {
            nats: {
                request_nonce: requestNonce,
                server_id: { id: serverId },
                user_nkey: natsServicePublicKey,
                connect_opts: {
                    auth_token: 'service-token',
                },
            },
        }
        const servicePermissions = {
            pub: { allow: ['svc.publish'] },
            sub: { allow: ['svc.subscribe'] },
        }
        const serviceAuthConfigs = [
            {
                publicKey: rawServicePublicKey,
                userId: rawServiceUser,
                account: 'NEX',
                permissions: servicePermissions,
            },
        ]
        decodeMock.mockImplementation((value: any, options: any) => {
            if (options?.complete) return { payload: { iss: rawServicePublicKey } }
            if (options?.json) return request
            return null
        })

        verifyNKeySignedJWTMock.mockResolvedValue({ decoded: { sub: rawServiceUser } })
        auth0JwtVerifier.verify = vi.fn().mockResolvedValue({ decoded: { sub: 'wrong-user' } })

        await startNatsAuthCalloutService({
            natsService: natsServiceMock as unknown as any,
            subscriptions: [],
            nKeyIssuerSeed: 'nKeyIssuerSeed',
            xKeyIssuerSeed: 'xKeyIssuerSeed',
            jwtAudience: 'aud',
            jwtIssuer: 'iss',
            jwksUri: 'https://example.com/jwks',
            serviceAuthConfigs,
            natsAuthAccount: 'AUTH',
        })
        const response = await authCalloutCallback!(undefined as never, buildAuthRequest(request))

        expect(response).toBe('SIGNED-AUTH-RESPONSE')
        expect(verifyNKeySignedJWTMock).toHaveBeenCalledWith({
            token: 'service-token',
            publicKey: rawServicePublicKey,
        })
        expect(encodeUserMock).toHaveBeenCalledWith(
            rawServiceUser,
            natsServicePublicKey,
            authorizationIssuerKeyPair,
            expect.objectContaining({
                ...servicePermissions,
                type: 'user',
                version: 2,
            }),
            { aud: 'NEX' },
        )
    })

    it('authenticates native NKey challenge responses and verifies signature', async () => {
        const request = {
            nats: {
                request_nonce: requestNonce,
                server_id: { id: serverId },
                user_nkey: natsServicePublicKey,
                connect_opts: {
                    nkey: rawServicePublicKey,
                    sig: challengeSignature,
                },
            },
        }

        fromPublicMock.mockReturnValue(rawNKeyVerifier)
        rawNKeyVerifier.verify.mockReturnValue(true)
        decodeMock.mockImplementation((value: any, options: any) => {
            if (options?.complete) return { payload: { iss: '' } }
            if (options?.json) return request
            return null
        })

        await startNatsAuthCalloutService({
            natsService: natsServiceMock as unknown as any,
            subscriptions: [],
            nKeyIssuerSeed: 'nKeyIssuerSeed',
            xKeyIssuerSeed: 'xKeyIssuerSeed',
            jwtAudience: 'aud',
            jwtIssuer: 'iss',
            jwksUri: 'https://example.com/jwks',
            serviceAuthConfigs: [
                {
                    publicKey: rawServicePublicKey,
                    userId: rawServiceUser,
                    permissions: { pub: { allow: ['svc.publish'] }, sub: { allow: ['svc.subscribe'] } },
                },
            ],
            natsAuthAccount: 'AUTH',
        })
        const response = await authCalloutCallback!(undefined as never, buildAuthRequest(request))

        expect(response).toBe('SIGNED-AUTH-RESPONSE')
        expect(fromPublicMock).toHaveBeenCalledWith(rawServicePublicKey)
        expect(rawNKeyVerifier.verify).toHaveBeenCalledWith(
            Buffer.from(requestNonce),
            Buffer.from('hello'),
        )
        expect(encodeUserMock).toHaveBeenCalledWith(
            rawServiceUser,
            natsServicePublicKey,
            authorizationIssuerKeyPair,
            expect.objectContaining({ type: 'user', version: 2 }),
            { aud: 'AUTH' },
        )
    })

    it('returns empty auth response when raw NKey challenge fields are incomplete', async () => {
        const request = {
            nats: {
                request_nonce: requestNonce,
                server_id: { id: serverId },
                user_nkey: natsServicePublicKey,
                connect_opts: {
                    nkey: rawServicePublicKey,
                },
            },
        }
        decodeMock.mockImplementation((value: any, options: any) => {
            if (options?.complete) return { payload: { iss: '' } }
            if (options?.json) return request
            return null
        })

        await startNatsAuthCalloutService({
            natsService: natsServiceMock as unknown as any,
            subscriptions: [],
            nKeyIssuerSeed: 'nKeyIssuerSeed',
            xKeyIssuerSeed: 'xKeyIssuerSeed',
            jwtAudience: 'aud',
            jwtIssuer: 'iss',
            jwksUri: 'https://example.com/jwks',
            natsAuthAccount: 'AUTH',
        })
        const response = await authCalloutCallback!(undefined as never, buildAuthRequest(request))

        expect(response).toBe('')
        expect(encodeUserMock).not.toHaveBeenCalled()
    })

    it('returns empty auth response when token is missing and no raw NKey data exists', async () => {
        const request = {
            nats: {
                request_nonce: requestNonce,
                server_id: { id: serverId },
                user_nkey: natsServicePublicKey,
            },
        }
        decodeMock.mockImplementation((value: any, options: any) => {
            if (options?.complete) return { payload: { iss: '' } }
            if (options?.json) return request
            return null
        })

        await startNatsAuthCalloutService({
            natsService: natsServiceMock as unknown as any,
            subscriptions: [],
            nKeyIssuerSeed: 'nKeyIssuerSeed',
            xKeyIssuerSeed: 'xKeyIssuerSeed',
            jwtAudience: 'aud',
            jwtIssuer: 'iss',
            jwksUri: 'https://example.com/jwks',
            natsAuthAccount: 'AUTH',
        })
        const response = await authCalloutCallback!(undefined as never, buildAuthRequest(request))

        expect(response).toBe('')
        expect(encodeAuthorizationResponseMock).not.toHaveBeenCalled()
    })
})

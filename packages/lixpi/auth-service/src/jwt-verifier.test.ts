'use strict'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'

const createGetKeyFunctionMock = vi.hoisted(() => vi.fn())
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: 'pkcs1',
        format: 'pem',
    },
    privateKeyEncoding: {
        type: 'pkcs1',
        format: 'pem',
    },
})

const createJwtToken = (claims: Record<string, unknown>) => jwt.sign(
    { sub: 'user-123', ...claims },
    privateKey,
    {
        audience: 'lixpi-audience',
        issuer: 'https://auth.test/',
        algorithm: 'RS256',
    },
)

// =============================================================================
// VERIFY JWT
// =============================================================================

vi.mock('./jwks-client.ts', () => ({
    createGetKeyFunction: createGetKeyFunctionMock,
}))

import { createJwtVerifier, verifyJwt } from './jwt-verifier.ts'

describe('verifyJwt', () => {
    it('returns an error for missing token', async () => {
        const result = await verifyJwt({
            getKey: (_header, cb) => cb(null, publicKey),
            token: '',
            audience: 'lixpi-audience',
            issuer: 'https://auth.test/',
        })

        expect(result).toEqual({ error: 'No token provided' })
    })

    it('resolves decoded payload when jwt is valid', async () => {
        const result = await verifyJwt({
            getKey: (_header, callback) => callback(null, publicKey),
            token: createJwtToken({ role: 'editor' }),
            audience: 'lixpi-audience',
            issuer: 'https://auth.test/',
        })

        expect(result.decoded).toMatchObject({
            sub: 'user-123',
            role: 'editor',
            aud: 'lixpi-audience',
            iss: 'https://auth.test/',
        })
    })

    it('rejects with the verification message when jwt verify fails', async () => {
        await expect(verifyJwt({
            getKey: (_header, callback) => callback(null, publicKey),
            token: createJwtToken({}),
            audience: 'wrong-audience',
            issuer: 'https://auth.test/',
        })).rejects.toMatchObject({
            error: expect.stringContaining('audience'),
        })
    })

    it('rejects when key resolution callback returns an error', async () => {
        await expect(verifyJwt({
            getKey: (_header, callback) => callback(new Error('boom')),
            token: createJwtToken({}),
            audience: 'lixpi-audience',
            issuer: 'https://auth.test/',
        })).rejects.toMatchObject({
            error: 'error in secret or public key callback: boom',
        })
    })
})

// =============================================================================
// JWT VERIFIER FACTORY
// =============================================================================

describe('createJwtVerifier', () => {
    const config = {
        jwksUri: 'https://auth.test/.well-known/jwks.json',
        audience: 'lixpi-audience',
        issuer: 'https://auth.test/',
    }

    const getValidToken = () => createJwtToken({ scope: 'write' })

    const makeGetKey = (resolvedKey: string) => vi.fn((
        _header: unknown,
        callback: (error: Error | null, key?: string) => void,
    ) => callback(null, resolvedKey))

    beforeEach(() => {
        createGetKeyFunctionMock.mockReset()
        vi.clearAllMocks()
    })

    afterEach(() => {
        createGetKeyFunctionMock.mockReset()
    })

    it('creates verifier with configured jwks URI and exposes getKey', () => {
        createGetKeyFunctionMock.mockReturnValue(makeGetKey(publicKey))

        const verifier = createJwtVerifier(config)

        expect(createGetKeyFunctionMock).toHaveBeenCalledWith(config.jwksUri)
        expect(verifier.getKey).toBeInstanceOf(Function)
    })

    it('returns decoded payload via verify using resolved JWKS key', async () => {
        const getKey = makeGetKey(publicKey)
        createGetKeyFunctionMock.mockReturnValue(getKey)

        const verifier = createJwtVerifier(config)
        const result = await verifier.verify(getValidToken())

        expect(result.decoded).toMatchObject({
            sub: 'user-123',
            scope: 'write',
        })
        expect(getKey).toHaveBeenCalled()
    })

    it('surfaces verification failures when algorithm config is incompatible', async () => {
        const getKey = makeGetKey(publicKey)
        createGetKeyFunctionMock.mockReturnValue(getKey)
        const verifier = createJwtVerifier({
            ...config,
            algorithms: ['HS256'],
        })

        await expect(verifier.verify(getValidToken())).rejects.toMatchObject({
            error: 'invalid algorithm',
        })
    })
})

'use strict'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'

const getSigningKey = vi.hoisted(() => vi.fn())
const createJwksClientMock = vi.hoisted(() =>
    vi.fn(() => ({
        getSigningKey,
    }))
)

vi.mock('jwks-rsa', () => ({
    default: createJwksClientMock,
}))

import {
    createGetKeyFunction,
    createJwksClient,
} from './jwks-client.ts'

type GetKeyFunction = (
    header: { kid: string },
    callback: (err: Error | null, key?: string) => void,
) => void

const invokeGetKey = (getKey: GetKeyFunction, kid = 'test-kid') =>
    new Promise<{ error: Error | null; key: string | undefined }>((resolve) => {
        getKey({ kid }, (error, key) => {
            resolve({
                error: error ? (error as Error) : null,
                key,
            })
        })
    })

// =============================================================================
// JWKS CLIENT FACTORY
// =============================================================================

describe('createJwksClient', () => {
    afterEach(() => {
        createJwksClientMock.mockReset()
        getSigningKey.mockReset()
    })

    it('applies default jwks options when no overrides are provided', () => {
        const jwksUri = 'https://auth.test/.well-known/jwks.json'
        const client = createJwksClient({ jwksUri })

        expect(createJwksClientMock).toHaveBeenCalledWith({
            jwksUri,
            cache: true,
            rateLimit: true,
            jwksRequestsPerMinute: 10,
        })
        expect(client).toBeDefined()
    })

    it('passes custom jwks options through to the jwks client', () => {
        const jwksUri = 'https://auth.test/.well-known/jwks.json'
        createJwksClient({
            jwksUri,
            cache: false,
            rateLimit: false,
            jwksRequestsPerMinute: 5,
        })

        expect(createJwksClientMock).toHaveBeenCalledWith({
            jwksUri,
            cache: false,
            rateLimit: false,
            jwksRequestsPerMinute: 5,
        })
    })
})

// =============================================================================
// GET KEY FUNCTION
// =============================================================================

describe('createGetKeyFunction', () => {
    const createFunctionUnderTest = () => createGetKeyFunction('https://auth.test/.well-known/jwks.json')

    beforeEach(() => {
        createJwksClientMock.mockClear()
        getSigningKey.mockReset()
    })

    afterEach(() => {
        getSigningKey.mockReset()
        createJwksClientMock.mockClear()
    })

    it('resolves publicKey from the jwks client return value', async () => {
        getSigningKey.mockImplementation((_kid, callback) => {
            callback(null, { publicKey: '-----BEGIN PUBLIC KEY-----\n' })
        })
        const getKey = createFunctionUnderTest()

        const result = await invokeGetKey(getKey)

        expect(result).toEqual({ error: null, key: '-----BEGIN PUBLIC KEY-----\n' })
    })

    it('falls back to rsaPublicKey when publicKey is missing', async () => {
        getSigningKey.mockImplementation((_kid, callback) => {
            callback(null, { rsaPublicKey: '-----BEGIN RSA PUBLIC KEY-----\n' })
        })
        const getKey = createFunctionUnderTest()

        const result = await invokeGetKey(getKey)

        expect(result).toEqual({
            error: null,
            key: '-----BEGIN RSA PUBLIC KEY-----\n',
        })
    })

    it('reports an error when no key is returned', async () => {
        getSigningKey.mockImplementation((_kid, callback) => {
            callback(null, undefined)
        })
        const getKey = createFunctionUnderTest()

        const result = await invokeGetKey(getKey)

        expect(result.error).toBeInstanceOf(Error)
        expect(result.error?.message).toBe('No signing key found')
        expect(result.key).toBeUndefined()
    })

    it('reports an error when signing key object has no key material', async () => {
        getSigningKey.mockImplementation((_kid, callback) => {
            callback(null, { somethingElse: 'no-key-data' })
        })
        const getKey = createFunctionUnderTest()

        const result = await invokeGetKey(getKey)

        expect(result.error).toBeInstanceOf(Error)
        expect(result.error?.message).toBe('No public key found in signing key')
    })

    it('surfaces errors from the jwks client', async () => {
        getSigningKey.mockImplementation((_kid, callback) => {
            callback(new Error('upstream failure'))
        })
        const getKey = createFunctionUnderTest()

        const result = await invokeGetKey(getKey)

        expect(result.error).toBeInstanceOf(Error)
        expect(result.error?.message).toBe('upstream failure')
    })

    it('catches synchronous jwks client exceptions and converts to callback error', async () => {
        getSigningKey.mockImplementation(() => {
            throw new Error('sync failure')
        })
        const getKey = createFunctionUnderTest()

        const result = await invokeGetKey(getKey)

        expect(result.error).toBeInstanceOf(Error)
        expect(result.error?.message).toBe('sync failure')
        expect(result.key).toBeUndefined()
    })
})

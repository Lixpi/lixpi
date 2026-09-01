'use strict'

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest'
import nkeys from '@nats-io/nkeys'

import { verifyNKeySignedJWT } from './nkey-verifier.ts'

type SigningPair = ReturnType<typeof nkeys.fromSeed>

const toBase64Url = (value: string) => Buffer.from(value, 'utf8').toString('base64url')

const createSignedToken = ({
    claims,
    publicKey,
    signingPair,
}: {
    claims: Record<string, unknown>
    publicKey: string
    signingPair: SigningPair
}) => {
    const header = {
        alg: 'EdDSA',
        typ: 'JWT',
    }

    const payload = {
        iss: publicKey,
        ...claims,
    }

    const message = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(JSON.stringify(payload))}`
    const signature = Buffer.from(signingPair.sign(Buffer.from(message))).toString('base64url')

    return `${message}.${signature}`
}

describe('verifyNKeySignedJWT', () => {
    const keyPair = nkeys.createUser()
    const signer = nkeys.fromSeed(keyPair.getSeed())
    const badSigner = nkeys.fromSeed(nkeys.createUser().getSeed())
    const publicKey = keyPair.getPublicKey()

    const createValidClaims = (claims: Record<string, unknown> = {}) => {
        const now = Math.floor(Date.now() / 1000)
        return {
            sub: 'svc:llm',
            nbf: now - 10,
            exp: now + 60,
            ...claims,
        }
    }

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('returns decoded payload for valid nkey-signed tokens', async () => {
        const token = createSignedToken({
            publicKey,
            signingPair: signer,
            claims: createValidClaims(),
        })
        const result = await verifyNKeySignedJWT({ token, publicKey })

        expect(result.error).toBeUndefined()
        expect(result.decoded).toMatchObject({ sub: 'svc:llm', iss: publicKey })
    })

    it('returns an error when token is missing', async () => {
        const result = await verifyNKeySignedJWT({ token: '', publicKey })

        expect(result).toEqual({ error: 'No token provided' })
    })

    it('returns an error when public key is missing', async () => {
        const result = await verifyNKeySignedJWT({ token: 'x', publicKey: '' })

        expect(result).toEqual({ error: 'No public key provided' })
    })

    it('returns an error when token format is invalid', async () => {
        const result = await verifyNKeySignedJWT({ token: 'not-a-jwt', publicKey })

        expect(result.error).toBe('Invalid JWT format')
    })

    it('returns an error when issuer claim does not match expected key', async () => {
        const token = createSignedToken({
            publicKey,
            signingPair: signer,
            claims: createValidClaims(),
        })

        const result = await verifyNKeySignedJWT({
            token,
            publicKey: 'wrong-issuer',
        })

        expect(result.error).toBe(`JWT issuer mismatch: expected wrong-issuer, got ${publicKey}`)
    })

    it('returns an error when the token has expired', async () => {
        const token = createSignedToken({
            publicKey,
            signingPair: signer,
            claims: createValidClaims({
                exp: Math.floor(Date.now() / 1000) - 1,
            }),
        })

        const result = await verifyNKeySignedJWT({ token, publicKey })

        expect(result.error).toBe('JWT expired')
    })

    it('returns an error when the token is not yet valid', async () => {
        const token = createSignedToken({
            publicKey,
            signingPair: signer,
            claims: createValidClaims({
                nbf: Math.floor(Date.now() / 1000) + 60,
            }),
        })

        const result = await verifyNKeySignedJWT({ token, publicKey })

        expect(result.error).toBe('JWT not yet valid')
    })

    it('returns an error when signature does not verify', async () => {
        const token = createSignedToken({
            publicKey,
            signingPair: badSigner,
            claims: createValidClaims(),
        })

        const result = await verifyNKeySignedJWT({ token, publicKey })

        expect(result.error).toBe('Invalid NKey signature')
    })
})

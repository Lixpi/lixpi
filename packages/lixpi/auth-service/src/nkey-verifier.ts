'use strict'

import jwt from 'jsonwebtoken'
import { fromPublic } from '@nats-io/nkeys'

import type { NKeyVerificationResult } from './types.ts'

export const verifyNKeySignedJWT = async ({
    token,
    publicKey
}: {
    token: string
    publicKey: string
}): Promise<NKeyVerificationResult> => {
    if (!token) return { error: 'No token provided' }
    if (!publicKey) return { error: 'No public key provided' }

    try {
        const decoded = jwt.decode(token, { complete: true })

        if (!decoded || typeof decoded === 'string') {
            return { error: 'Invalid JWT format' }
        }

        if (decoded.payload.iss !== publicKey) {
            return { error: `JWT issuer mismatch: expected ${publicKey}, got ${decoded.payload.iss}` }
        }

        const nkey = fromPublic(publicKey)

        const parts = token.split('.')
        if (parts.length !== 3) {
            return { error: 'Invalid JWT structure' }
        }

        const message = `${parts[0]}.${parts[1]}`
        const signatureB64 = parts[2]

        const signature = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

        const isValid = nkey.verify(Buffer.from(message), signature)

        if (!isValid) {
            return { error: 'Invalid NKey signature' }
        }

        const now = Math.floor(Date.now() / 1000)
        if (decoded.payload.exp && decoded.payload.exp < now) {
            return { error: 'JWT expired' }
        }

        if (decoded.payload.nbf && decoded.payload.nbf > now) {
            return { error: 'JWT not yet valid' }
        }

        return { decoded: decoded.payload }
    } catch (error: any) {
        return { error: error.message }
    }
}

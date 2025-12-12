'use strict'

import jwt from 'jsonwebtoken'

import { createGetKeyFunction } from './jwks-client.ts'
import type { JwtVerifierConfig, JwtVerificationResult } from './types.ts'

export const verifyJwt = async ({
    getKey,
    token,
    audience,
    issuer,
    algorithms = ['RS256']
}: {
    getKey: (header: any, callback: (err: Error | null, key?: string) => void) => void
    token: string
    audience: string
    issuer: string
    algorithms?: string[]
}): Promise<JwtVerificationResult> => {
    if (!token) return { error: 'No token provided' }

    return new Promise((resolve, reject) => {
        jwt.verify(
            token,
            getKey,
            {
                audience,
                issuer,
                algorithms
            },
            (error, decoded) => {
                if (error) {
                    reject({ error: error.message })
                    return
                }

                if (decoded) {
                    resolve({ decoded })
                }
            }
        )
    })
}

export const createJwtVerifier = (config: JwtVerifierConfig) => {
    const getKey = createGetKeyFunction(config.jwksUri)

    return {
        verify: async (token: string): Promise<JwtVerificationResult> => {
            return verifyJwt({
                getKey,
                token,
                audience: config.audience,
                issuer: config.issuer,
                algorithms: config.algorithms ?? ['RS256']
            })
        },

        getKey
    }
}

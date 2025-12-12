'use strict'

import jwksClientLib from 'jwks-rsa'

export type JwksClientConfig = {
    jwksUri: string
    cache?: boolean
    rateLimit?: boolean
    jwksRequestsPerMinute?: number
}

export const createJwksClient = (config: JwksClientConfig) => {
    return jwksClientLib({
        jwksUri: config.jwksUri,
        cache: config.cache ?? true,
        rateLimit: config.rateLimit ?? true,
        jwksRequestsPerMinute: config.jwksRequestsPerMinute ?? 10
    })
}

export const createGetKeyFunction = (jwksUri: string) => {
    const client = createJwksClient({ jwksUri })

    return (header: any, callback: (err: Error | null, key?: string) => void) => {
        try {
            client.getSigningKey(header.kid, (error, key) => {
                if (error) {
                    return callback(error, undefined)
                }

                if (!key) {
                    return callback(new Error('No signing key found'), undefined)
                }

                const publicKey = key.publicKey || key.rsaPublicKey
                if (!publicKey) {
                    return callback(new Error('No public key found in signing key'), undefined)
                }

                callback(null, publicKey)
            })
        } catch (error: any) {
            callback(error, undefined)
        }
    }
}

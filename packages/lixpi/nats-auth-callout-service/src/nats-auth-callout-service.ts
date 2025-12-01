'use strict'

import c from 'chalk'
import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'
import { fromSeed, fromPublic } from '@nats-io/nkeys'
import { encodeUser, encodeAuthorizationResponse } from '@nats-io/jwt'

import type { NatsService } from '@lixpi/nats-service'
import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'


const getPermissionsForUser = (userId: string, subscriptions, servicePermissions?: { pub: { allow: string[] }, sub: { allow: string[] } }) => {
    // If service-specific permissions are provided, use them
    if (servicePermissions) {
        info('Service permissions (restricted service account):', servicePermissions)
        return servicePermissions
    }

    // Regular user permissions (Auth0-authenticated users)
    const resolvedPermissions = {
        pub: {
            allow: [
                "_INBOX.>"
            ]
        },
        sub: {
            allow: [
                "_INBOX.>"
            ]
        }
    }

    subscriptions.forEach(subject => {
        if (subject.permissions) {
            const { pub, sub } = subject.permissions
            const pubAllows = pub && pub.allow ? pub.allow.map(s => s.replace('{userId}', userId)) : []
            const subAllows = sub && sub.allow ? sub.allow.map(s => s.replace('{userId}', userId)) : []

            resolvedPermissions.pub.allow.push(...pubAllows)
            resolvedPermissions.sub.allow.push(...subAllows)
        }
    })

    info('Final resolved permissions:', resolvedPermissions)
    return resolvedPermissions
}

/**
 * Verify a self-issued JWT signed with an NKey (Ed25519)
 * Used for internal service-to-service authentication (e.g., llm-api)
 */
export const verifyNKeySignedJWT = async ({
    token,
    publicKey
}: {
    token: string,
    publicKey: string
}) => {
    if (!token) return { error: "No token provided" }
    if (!publicKey) return { error: "No public key provided" }

    try {
        // Decode JWT without verification first to check issuer
        const decoded = jwt.decode(token, { complete: true })

        if (!decoded || typeof decoded === 'string') {
            return { error: "Invalid JWT format" }
        }

        // Verify the issuer matches the expected public key
        if (decoded.payload.iss !== publicKey) {
            return { error: `JWT issuer mismatch: expected ${publicKey}, got ${decoded.payload.iss}` }
        }

        // Create NKey verifier from public key
        const nkey = fromPublic(publicKey)

        // Extract signature from JWT (remove "Bearer " prefix if present)
        const parts = token.split('.')
        if (parts.length !== 3) {
            return { error: "Invalid JWT structure" }
        }

        // For NKey-signed JWTs, we need to verify using the NKey library
        // The signature is base64url-encoded in the third part
        const message = `${parts[0]}.${parts[1]}`
        const signatureB64 = parts[2]

        // Convert base64url to base64
        const signature = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

        // Verify signature
        const isValid = nkey.verify(Buffer.from(message), signature)

        if (!isValid) {
            return { error: "Invalid NKey signature" }
        }

        // Check expiration
        const now = Math.floor(Date.now() / 1000)
        if (decoded.payload.exp && decoded.payload.exp < now) {
            return { error: "JWT expired" }
        }

        // Check not-before
        if (decoded.payload.nbf && decoded.payload.nbf > now) {
            return { error: "JWT not yet valid" }
        }

        return { decoded: decoded.payload }
    } catch (error) {
        return { error: error.message }
    }
}

export const authenticateTokenOnRequest = async ({
    getKey,
    token,
    audience,
    issuer,
    algorithms = ['RS256']
 }) => {
    if (!token) return { error: "authenticateTokenOnRequest() -> No token provided" }

    return new Promise((resolve, reject) => jwt.verify(
        token,
        getKey,
        {
            aud: audience,
            issuer,
            algorithms
        },
        async (error, decoded) => {
            if (error) reject({ error })

            if (decoded) {

                resolve({ decoded })
            }
        }
    ))
}

// Authenticate internal services using self-issued JWTs signed with NKeys.
// Services sign their own tokens with Ed25519 private keys, we verify the signature
// using the registered public key. No external Auth0 calls, just cryptographic verification.
const authenticateServiceJWT = async (
    token: string,
    serviceConfig: ServiceAuthConfig
): Promise<{ userId: string, permissions: ServiceAuthConfig['permissions'] }> => {
    info(`Auth callout: Verifying self-issued JWT from service (issuer: ${serviceConfig.publicKey.substring(0, 10)}...)`)

    const { decoded, error } = await verifyNKeySignedJWT({
        token,
        publicKey: serviceConfig.publicKey
    })

    if (error) {
        err('Self-issued JWT verification failed:', error)
        throw new Error(`Self-issued JWT verification failed: ${error}`)
    }

    const userId = decoded.sub
    if (!userId) {
        throw new Error('User ID ("sub") missing in self-issued JWT')
    }

    // Verify the userId matches the expected service identity
    if (userId !== serviceConfig.userId) {
        throw new Error(`User ID mismatch: expected ${serviceConfig.userId}, got ${userId}`)
    }

    info(`Auth callout: Service authenticated via self-issued JWT (${userId})`)

    return { userId, permissions: serviceConfig.permissions }
}

// Authenticate regular users via Auth0 OAuth2/OIDC flow.
// User tokens are issued by Auth0, we verify them against Auth0's JWKS endpoint.
// Permissions come from subscription definitions, not hardcoded in the token.
const authenticateAuth0JWT = async (
    token: string,
    getKey: any,
    jwtAudience: string,
    jwtIssuer: string,
    jwtAlgorithms: string[]
): Promise<{ userId: string }> => {
    info('Auth callout: Verifying Auth0 JWT...')

    const { decoded, error } = await authenticateTokenOnRequest({
        getKey,
        token,
        audience: jwtAudience,
        issuer: jwtIssuer,
        algorithms: jwtAlgorithms
    })

    if (error) {
        err('Auth0 token verification failed:', error)
        throw new Error(`Token verification failed: ${error.message}`)
    }

    const userId = decoded.sub
    if (!userId) {
        throw new Error('User ID ("sub") missing in Auth0 JWT')
    }

    info(`Auth callout: Auth0 user authenticated (${userId})`)

    return { userId }
}

type ServiceAuthConfig = {
    publicKey: string
    userId: string
    permissions: {
        pub: { allow: string[] }
        sub: { allow: string[] }
    }
}

export const startNatsAuthCalloutService = async ({
    natsService,
    subscriptions,
    nKeyIssuerSeed,
    xKeyIssuerSeed,
    jwtAudience,
    jwtIssuer,
    jwksUri,
    jwtAlgorithms = ['RS256'],
    natsAuthAccount,
    serviceAuthConfigs = []
  }: {
    natsService: NatsService,
    subscriptions: any[],
    nKeyIssuerSeed: string,
    xKeyIssuerSeed: string
    jwtAudience: string,
    jwtIssuer: string,
    jwksUri: string,
    jwtAlgorithms?: string[]
    natsAuthAccount: string
    serviceAuthConfigs?: ServiceAuthConfig[]
  }) => {
    if (!nKeyIssuerSeed) {
        throw new Error('Issuer seed for NATS auth callout not provided!')
    }

    if (!xKeyIssuerSeed) {
        throw new Error('xKeyIssuerSeed for NATS auth callout not provided!')
    }

    const nKeyPair = fromSeed(Buffer.from(nKeyIssuerSeed))
    const xKeyPair = fromSeed(Buffer.from(xKeyIssuerSeed))

    const getKey = (header, callback) => {
        try {
            jwksClient({ jwksUri }).getSigningKey(header.kid, (error, key) => {
                if (error) {
                    err('JWKS client error:', error)
                    return callback(error, null)
                }

                if (!key) {
                    const keyError = new Error('No signing key found')
                    err('No signing key found for kid:', header.kid)
                    return callback(keyError, null)
                }

                const publicKey = key.publicKey || key.rsaPublicKey
                if (!publicKey) {
                    const keyError = new Error('No public key found in signing key')
                    err('No public key found in signing key for kid:', header.kid)
                    return callback(keyError, null)
                }

                callback(null, publicKey)
            })
        } catch (error) {
            err('Error in getKey function:', error)
            callback(error, null)
        }
    }


    natsService.reply('$SYS.REQ.USER.AUTH', async (data, msg) => {
        try {
            // INFO: `senderPublicCurveKey` also called `xkey` in NATS configuration
            const senderPublicCurveKey = msg.headers?.get('Nats-Server-Xkey')

            if (!senderPublicCurveKey) {
                return new Error('Missing Nats-Server-Xkey in request headers!')
            }

            // Decrypt request signed by curve key using the curve keypair
            const decryptedJWT = xKeyPair.open(msg.data, senderPublicCurveKey)

            if (!decryptedJWT) {
                return new Error('Curve decryption failed')
            }

            const decodedRequest = jwt.decode(new TextDecoder().decode(decryptedJWT), { json: true })

            const connectOpts = decodedRequest?.nats?.connect_opts
            const auth0token = connectOpts?.auth_token

            if (!auth0token) {
                throw new Error('Token missing in client connect options.')
            }

            // Check if this is a self-issued JWT from a registered service (NKey-signed)
            // Decode token to check issuer without verification
            const decodedToken = jwt.decode(auth0token, { complete: true })

            // Find matching service auth config by issuer
            const serviceConfig = serviceAuthConfigs.find(
                config => decodedToken && typeof decodedToken !== 'string' &&
                         decodedToken.payload.iss === config.publicKey
            )

            // Authenticate and get user identity + permissions
            let userId: string
            let servicePermissions: ServiceAuthConfig['permissions'] | undefined

            if (serviceConfig) {
                const result = await authenticateServiceJWT(auth0token, serviceConfig)
                userId = result.userId
                servicePermissions = result.permissions
            } else {
                const result = await authenticateAuth0JWT(auth0token, getKey, jwtAudience, jwtIssuer, jwtAlgorithms)
                userId = result.userId
            }

            // Get user permissions
            const permissions = getPermissionsForUser(userId, subscriptions, servicePermissions)

            // Each session has a unique nkey
            const userNkey = decodedRequest.nats.user_nkey

            // The userJWT will be encoded with the proper structure
            const userJWT = await encodeUser(
                userId,
                userNkey,
                nKeyPair,
                {
                    ...permissions,
                    type: 'user',
                    version: 2,
                },
                {
                    aud: natsAuthAccount
                }
            )

            // Create auth response using the NATS JWT library
            const responseJWT = await encodeAuthorizationResponse(
                userNkey,
                decodedRequest.nats.server_id.id,
                nKeyPair.getPublicKey(),
                {
                    jwt: userJWT,
                    type: 'auth_response',
                    version: 2
                },
                {
                    signer: nKeyPair
                }
            )

            return responseJWT
        } catch (error) {
            err(`Auth Callout Error: ${error.message}`, error)

            return ''    // Return an empty JWT which will be treated as an auth failure
        }
    }, {}, 'buffer')

    info('NATS Auth Callout Service started successfully')
}

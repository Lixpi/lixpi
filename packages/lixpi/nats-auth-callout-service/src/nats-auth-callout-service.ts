'use strict'

import jwt from 'jsonwebtoken'
import { fromSeed } from '@nats-io/nkeys'
import { encodeUser, encodeAuthorizationResponse } from '@nats-io/jwt'

import type { NatsService } from '@lixpi/nats-service'
import { info, err } from '@lixpi/debug-tools'
import {
    createJwtVerifier,
    verifyNKeySignedJWT as verifyNKeyJWT,
    type ServiceAuthConfig
} from '@lixpi/auth-service'


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

// Re-export verifyNKeySignedJWT from auth-service for backwards compatibility
export { verifyNKeySignedJWT } from '@lixpi/auth-service'

// Authenticate internal services using self-issued JWTs signed with NKeys.
// Services sign their own tokens with Ed25519 private keys, we verify the signature
// using the registered public key. No external Auth0 calls, just cryptographic verification.
const authenticateServiceJWT = async (
    token: string,
    serviceConfig: ServiceAuthConfig
): Promise<{ userId: string, permissions: ServiceAuthConfig['permissions'] }> => {
    info(`Auth callout: Verifying self-issued JWT from service (issuer: ${serviceConfig.publicKey.substring(0, 10)}...)`)

    const { decoded, error } = await verifyNKeyJWT({
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
    jwtVerifier: ReturnType<typeof createJwtVerifier>
): Promise<{ userId: string }> => {
    info('Auth callout: Verifying Auth0 JWT...')

    try {
        const { decoded, error } = await jwtVerifier.verify(token)

        if (error) {
            err('Auth0 token verification failed:', error)
            throw new Error(`Token verification failed: ${error}`)
        }

        const userId = decoded.sub
        if (!userId) {
            throw new Error('User ID ("sub") missing in Auth0 JWT')
        }

        info(`Auth callout: Auth0 user authenticated (${userId})`)

        return { userId }
    } catch (e: any) {
        err('Auth0 token verification failed:', e)
        throw new Error(`Token verification failed: ${e.error || e.message}`)
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

    // Create JWT verifier for Auth0 tokens
    const jwtVerifier = createJwtVerifier({
        jwksUri,
        audience: jwtAudience,
        issuer: jwtIssuer,
        algorithms: jwtAlgorithms
    })


    natsService.reply('$SYS.REQ.USER.AUTH', async (data: any, msg: any) => {
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
                const result = await authenticateAuth0JWT(auth0token, jwtVerifier)
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
        } catch (error: any) {
            err(`Auth Callout Error: ${error.message}`, error)

            return ''    // Return an empty JWT which will be treated as an auth failure
        }
    }, {}, 'buffer')

    info('NATS Auth Callout Service started successfully')
}

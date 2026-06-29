'use strict'

import jsonWebToken from 'jsonwebtoken'
import { fromPublic, fromSeed } from '@nats-io/nkeys'
import { encodeUser, encodeAuthorizationResponse } from '@nats-io/jwt'

import type { NatsService } from '@lixpi/nats-service'
import { info, err as logError } from '@lixpi/debug-tools'
import {
    createJwtVerifier,
    verifyNKeySignedJWT as verifyNKeyJwt,
    type ServiceAuthConfig
} from '@lixpi/auth-service'


type AuthenticatedNatsClient = {
    // Lixpi identity that will appear as the subject of the issued NATS user JWT.
    userId: string
    // Account audience for the issued NATS user JWT. Regular users land in AUTH;
    // NEX lands in NEX so its control-plane subjects stay account-isolated.
    targetNatsAccount: string
    // Internal services provide a complete allowlist. Browser/Auth0 users derive
    // permissions from the subscription table instead.
    servicePermissions?: ServiceAuthConfig['permissions']
}

// Only the auth fields this service consumes are modeled here. NATS forwards
// many more connect options, but keeping this narrow makes each auth path clear.
type NatsAuthCalloutConnectOptions = {
    auth_token?: string
    nkey?: string
    sig?: string
}

// Shape of the decrypted NATS authorization request. This mirrors the parts of
// the auth-callout JWT payload needed to authenticate the client and to sign the
// response for the ephemeral connection user nkey.
type NatsAuthCalloutRequest = {
    nats?: {
        connect_opts?: NatsAuthCalloutConnectOptions
        request_nonce?: string
        client_info?: {
            nonce?: string
        }
        user_nkey?: string
        server_id?: {
            id?: string
        }
    }
}

type RawNKeyChallengeFields = {
    // Public user NKey sent by the native NATS client in connect_opts.nkey.
    clientPublicNKey: string
    // Base64url signature over the NATS challenge nonce.
    clientSignature: string
    // Server nonce that the client had to sign to prove possession of the seed.
    challengeNonce: string
}

type ResolvedNatsPermissions = {
    pub: { allow: string[] }
    sub: { allow: string[] }
}

const appendUniquePermissionSubjects = ({
    target,
    seen,
    subjectPatterns,
    userId,
}: {
    target: string[]
    seen: Set<string>
    subjectPatterns: string[]
    userId: string
}): void => {
    for (const subjectPattern of subjectPatterns) {
        const subject = subjectPattern.replace('{userId}', userId)
        if (seen.has(subject)) continue
        seen.add(subject)
        target.push(subject)
    }
}

// Resolves the NATS permissions for the authenticated client.
//
// Internal services and NATS-native tools, like NEX, pass a complete permission
// allowlist through serviceAuthConfigs. In that case this function returns those
// service permissions unchanged because they are already the security boundary.
//
// Regular Auth0 users do not carry permissions in their browser token. Their
// permissions are derived from the subscription registry, with every `{userId}`
// placeholder expanded to the authenticated user. That keeps per-user subjects
// scoped without requiring dynamic NATS config.
const getPermissionsForUser = (
    userId: string,
    subscriptions: any[],
    servicePermissions?: ServiceAuthConfig['permissions']
) => {
    // If service-specific permissions are provided, use them
    if (servicePermissions) {
        info('Service permissions (restricted service account):', servicePermissions)
        return servicePermissions
    }

    // Regular user permissions (Auth0-authenticated users)
    const resolvedPermissions: ResolvedNatsPermissions = {
        pub: {
            allow: [
                '_INBOX.>'
            ]
        },
        sub: {
            allow: [
                '_INBOX.>'
            ]
        }
    }
    const seenPublicationSubjects = new Set(resolvedPermissions.pub.allow)
    const seenSubscriptionSubjects = new Set(resolvedPermissions.sub.allow)

    for (const subscription of subscriptions) {
        if (subscription.permissions) {
            const {
                pub: publicationPermissions,
                sub: subscriptionPermissions
            } = subscription.permissions

            appendUniquePermissionSubjects({
                target: resolvedPermissions.pub.allow,
                seen: seenPublicationSubjects,
                subjectPatterns: publicationPermissions?.allow ?? [],
                userId,
            })
            appendUniquePermissionSubjects({
                target: resolvedPermissions.sub.allow,
                seen: seenSubscriptionSubjects,
                subjectPatterns: subscriptionPermissions?.allow ?? [],
                userId,
            })
        }
    }

    info('Final resolved permissions:', resolvedPermissions)
    return resolvedPermissions
}

// Decodes a base64url value into bytes.
//
// NKey signatures in JWTs and native NATS connect options are encoded with the
// URL-safe base64 alphabet and usually omit padding. Node's Buffer decoder wants
// standard base64, so this helper normalizes the alphabet and restores padding
// before converting to bytes.
const decodeBase64Url = (value: string): Buffer => {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return Buffer.from(padded, 'base64')
}

// Re-export verifyNKeySignedJWT from auth-service for backwards compatibility
export { verifyNKeySignedJWT } from '@lixpi/auth-service'

// Authenticates an internal service that connects through the original Lixpi
// service-token path.
//
// The service sends a self-issued JWT in connect_opts.auth_token. The JWT's
// issuer must be the service public NKey, and that public key must match a
// registered serviceAuthConfig. Once the config is selected, this function does
// the real Ed25519 verification, checks that the JWT subject matches the
// expected service identity, and returns the identity/account/permissions that
// should be written into the final NATS user JWT.
//
// This path never calls Auth0. It is meant for trusted Lixpi infrastructure that
// can generate its own short-lived service JWT before opening a NATS connection.
const authenticateRegisteredServiceFromSelfIssuedJwt = async (
    token: string,
    serviceConfig: ServiceAuthConfig,
    defaultNatsAccount: string
): Promise<AuthenticatedNatsClient> => {
    info(`Auth callout: Verifying self-issued JWT from service (issuer: ${serviceConfig.publicKey.substring(0, 10)}...)`)

    const serviceJwtVerification = await verifyNKeyJwt({
        token,
        publicKey: serviceConfig.publicKey
    })

    if (serviceJwtVerification.error) {
        logError('Self-issued JWT verification failed:', serviceJwtVerification.error)
        throw new Error(`Self-issued JWT verification failed: ${serviceJwtVerification.error}`)
    }

    const serviceJwtPayload = serviceJwtVerification.decoded
    if (!serviceJwtPayload) {
        throw new Error('Self-issued JWT verified without a decoded payload')
    }

    const userId = serviceJwtPayload.sub
    if (!userId) {
        throw new Error('User ID ("sub") missing in self-issued JWT')
    }

    // Verify the userId matches the expected service identity
    if (userId !== serviceConfig.userId) {
        throw new Error(`User ID mismatch: expected ${serviceConfig.userId}, got ${userId}`)
    }

    info(`Auth callout: Service authenticated via self-issued JWT (${userId})`)

    return {
        userId,
        targetNatsAccount: serviceConfig.account ?? defaultNatsAccount,
        servicePermissions: serviceConfig.permissions
    }
}

// Authenticates a regular browser/API user through Auth0.
//
// This is the normal user path. The NATS client sends an Auth0 access token in
// connect_opts.auth_token. The shared Auth0 verifier checks the RS256 signature,
// issuer, audience, and validity windows through Auth0's JWKS metadata. On
// success, the Auth0 subject becomes the NATS user identity.
//
// Permissions are deliberately not returned here. They are resolved later from
// the subscription table so the user token does not have to embed NATS subject
// allowlists.
const authenticateRegularUserFromAuth0Jwt = async (
    token: string,
    auth0JwtVerifier: ReturnType<typeof createJwtVerifier>,
    defaultNatsAccount: string
): Promise<AuthenticatedNatsClient> => {
    info('Auth callout: Verifying Auth0 JWT...')

    try {
        const auth0JwtVerification = await auth0JwtVerifier.verify(token)

        if (auth0JwtVerification.error) {
            logError('Auth0 token verification failed:', auth0JwtVerification.error)
            throw new Error(`Token verification failed: ${auth0JwtVerification.error}`)
        }

        const auth0JwtPayload = auth0JwtVerification.decoded
        if (!auth0JwtPayload) {
            throw new Error('Auth0 JWT verified without a decoded payload')
        }

        const userId = auth0JwtPayload.sub
        if (!userId) {
            throw new Error('User ID ("sub") missing in Auth0 JWT')
        }

        info(`Auth callout: Auth0 user authenticated (${userId})`)

        return { userId, targetNatsAccount: defaultNatsAccount }
    } catch (caughtError: any) {
        logError('Auth0 token verification failed:', caughtError)
        throw new Error(`Token verification failed: ${caughtError.error || caughtError.message}`)
    }
}

// Finds the registered service config for a self-issued service JWT.
//
// This function only decodes the token; it does not trust or verify it. The
// decoded issuer is used as a routing hint so we know whether the token belongs
// to a registered internal service or should fall through to the Auth0 path.
// The actual signature verification happens immediately afterwards in
// authenticateRegisteredServiceFromSelfIssuedJwt.
const findServiceConfigForSelfIssuedJwt = (
    tokenFromConnectOptions: string,
    serviceAuthConfigs: ServiceAuthConfig[]
): ServiceAuthConfig | undefined => {
    // This is intentionally a decode-only step. We only use the unverified
    // issuer claim to decide whether this token should go through the internal
    // service verifier. The signature is verified immediately after this lookup.
    const decodedToken = jsonWebToken.decode(tokenFromConnectOptions, { complete: true })

    return serviceAuthConfigs.find(
        serviceConfig => decodedToken && typeof decodedToken !== 'string' &&
            decodedToken.payload.iss === serviceConfig.publicKey
    )
}

// Handles the original token-based auth-callout path.
//
// There are two valid client types on this path:
// - regular users with Auth0 JWTs
// - internal Lixpi services with self-issued NKey-signed JWTs
//
// The decision is made by looking for a registered service public key in the
// token issuer. If found, the service verifier owns the token. Otherwise the
// token is treated as an Auth0 user token. Keeping this logic in one method
// prevents the raw NKey NEX path from being mixed into the normal user/service
// token flow.
const authenticateClientUsingAuthTokenPath = async ({
    tokenFromConnectOptions,
    auth0JwtVerifier,
    serviceAuthConfigs,
    defaultNatsAccount
}: {
    tokenFromConnectOptions: string,
    auth0JwtVerifier: ReturnType<typeof createJwtVerifier>,
    serviceAuthConfigs: ServiceAuthConfig[],
    defaultNatsAccount: string
}): Promise<AuthenticatedNatsClient> => {
    // This is the original auth-callout path:
    // - a browser/user connection sends an Auth0 JWT in connect_opts.auth_token
    // - an internal Lixpi service sends a self-issued NKey-signed JWT there
    //
    // The issuer decides which verifier owns the token. Registered service
    // issuers use local Ed25519 verification; everything else falls back to the
    // Auth0 JWKS verifier.
    const serviceConfig = findServiceConfigForSelfIssuedJwt(tokenFromConnectOptions, serviceAuthConfigs)

    if (serviceConfig) {
        return authenticateRegisteredServiceFromSelfIssuedJwt(
            tokenFromConnectOptions,
            serviceConfig,
            defaultNatsAccount
        )
    }

    return authenticateRegularUserFromAuth0Jwt(
        tokenFromConnectOptions,
        auth0JwtVerifier,
        defaultNatsAccount
    )
}

// Extracts the native NATS NKey challenge-response fields from the decrypted
// auth-callout request.
//
// NATS-native tools do not necessarily send connect_opts.auth_token. Instead,
// clients like NEX can use standard NATS NKey auth: the client sends its public
// user NKey and a signature over the server nonce. NATS forwards those fields in
// the auth-callout request. This method validates that the raw NKey path is
// either completely absent or complete enough to verify.
//
// Returning undefined means "this request is not using raw NKey auth". Throwing
// means "the request tried to use raw NKey auth but did not provide enough data
// to verify it safely".
const extractRawNKeyChallengeFields = (
    authorizationRequest: NatsAuthCalloutRequest
): RawNKeyChallengeFields | undefined => {
    const connectOptions = authorizationRequest.nats?.connect_opts

    const clientPublicNKey = connectOptions?.nkey
    const clientSignature = connectOptions?.sig

    // Native NATS NKey auth signs the server nonce from INFO. Different NATS
    // payload examples expose that nonce under slightly different nesting, so
    // keep both names here and make the validation explicit.
    const challengeNonce = authorizationRequest.nats?.request_nonce ?? authorizationRequest.nats?.client_info?.nonce

    const hasAnyRawNKeyField = Boolean(clientPublicNKey || clientSignature || challengeNonce)
    if (!hasAnyRawNKeyField) return undefined

    if (!clientPublicNKey || !clientSignature || !challengeNonce) {
        throw new Error('Raw NKey client auth fields are incomplete.')
    }

    return {
        clientPublicNKey,
        clientSignature,
        challengeNonce
    }
}

// Authenticates a NATS-native client through the raw NKey challenge-response
// path.
//
// This is the NEX path. The client proves possession of the registered NKey seed
// by signing the NATS server nonce. The auth callout verifies that signature
// against the registered public key, then returns the configured Lixpi service
// identity, target NATS account, and permission allowlist.
//
// No Auth0 token and no self-issued service JWT are required here because the
// credential is the native NATS NKey handshake itself. This is why NEX can keep
// using the stock `--nats.nkey` / `--nats.seed` flags while still passing
// through centralized auth callout.
const authenticateClientUsingRawNKeyChallengePath = ({
    rawNKeyChallengeFields,
    serviceAuthConfigs,
    defaultNatsAccount
}: {
    rawNKeyChallengeFields: RawNKeyChallengeFields,
    serviceAuthConfigs: ServiceAuthConfig[],
    defaultNatsAccount: string
}): AuthenticatedNatsClient => {
    const serviceConfig = serviceAuthConfigs.find(
        config => config.publicKey === rawNKeyChallengeFields.clientPublicNKey
    )

    if (!serviceConfig) {
        throw new Error('Raw NKey client is not registered for auth callout.')
    }

    info(`Auth callout: Verifying raw NKey client auth (issuer: ${rawNKeyChallengeFields.clientPublicNKey.substring(0, 10)}...)`)

    // This verifies the standard NATS NKey handshake. The client proves it owns
    // the seed by signing the server nonce. We do not need a Lixpi JWT on this
    // path; possession of the registered seed is the credential.
    const clientPublicNKeyVerifier = fromPublic(rawNKeyChallengeFields.clientPublicNKey)
    const isSignatureValid = clientPublicNKeyVerifier.verify(
        Buffer.from(rawNKeyChallengeFields.challengeNonce),
        decodeBase64Url(rawNKeyChallengeFields.clientSignature)
    )

    if (!isSignatureValid) {
        throw new Error('Raw NKey signature verification failed')
    }

    info(`Auth callout: Service authenticated via raw NKey (${serviceConfig.userId})`)

    return {
        userId: serviceConfig.userId,
        targetNatsAccount: serviceConfig.account ?? defaultNatsAccount,
        servicePermissions: serviceConfig.permissions
    }
}

// Chooses the correct authentication path for one decrypted NATS authorization
// request.
//
// This method intentionally does not verify signatures itself. It only inspects
// the connect options and delegates to one of the two clear paths:
// - authenticateClientUsingAuthTokenPath for Auth0 users and self-issued service
//   JWTs
// - authenticateClientUsingRawNKeyChallengePath for NATS-native NKey clients
//
// If neither path has enough data, the request is rejected before a NATS user
// JWT is minted.
const authenticateClientFromAuthorizationRequest = async ({
    authorizationRequest,
    auth0JwtVerifier,
    serviceAuthConfigs,
    defaultNatsAccount
}: {
    authorizationRequest: NatsAuthCalloutRequest,
    auth0JwtVerifier: ReturnType<typeof createJwtVerifier>,
    serviceAuthConfigs: ServiceAuthConfig[],
    defaultNatsAccount: string
}): Promise<AuthenticatedNatsClient> => {
    // Keep routing between auth modes in one place:
    // 1. auth_token is the original Lixpi path for Auth0 users and self-issued
    //    internal service JWTs.
    // 2. raw NKey challenge fields are the NATS-native path used by NEX.
    // 3. anything else is rejected before a NATS user JWT can be issued.
    const tokenFromConnectOptions = authorizationRequest.nats?.connect_opts?.auth_token
    if (tokenFromConnectOptions) {
        return authenticateClientUsingAuthTokenPath({
            tokenFromConnectOptions,
            auth0JwtVerifier,
            serviceAuthConfigs,
            defaultNatsAccount
        })
    }

    const rawNKeyChallengeFields = extractRawNKeyChallengeFields(authorizationRequest)
    if (rawNKeyChallengeFields) {
        return authenticateClientUsingRawNKeyChallengePath({
            rawNKeyChallengeFields,
            serviceAuthConfigs,
            defaultNatsAccount
        })
    }

    throw new Error('Token missing in client connect options.')
}

// Decrypts and decodes the auth-callout request sent by NATS.
//
// NATS encrypts auth-callout requests to the configured XKey. The server's
// public curve key is carried in the Nats-Server-Xkey header, and this service
// opens the payload with the matching private XKey seed. The decrypted payload
// is itself a JWT containing the client connect options, ephemeral user nkey,
// and server id needed to build the authorization response.
//
// This method is intentionally only about transport decoding. It does not decide
// whether the client is allowed to connect.
const decryptAuthorizationRequest = ({
    encryptedAuthorizationRequest,
    requestMessage,
    authorizationRequestCurveKeyPair
}: {
    encryptedAuthorizationRequest: Uint8Array,
    requestMessage: any,
    authorizationRequestCurveKeyPair: ReturnType<typeof fromSeed>
}): NatsAuthCalloutRequest => {
    // INFO: `senderPublicCurveKey` is the same value NATS config calls `xkey`.
    // NATS encrypts the auth-callout request to our public curve key; this
    // service opens it with the matching private curve seed.
    const senderPublicCurveKey = requestMessage.headers?.get('Nats-Server-Xkey')

    if (!senderPublicCurveKey) {
        throw new Error('Missing Nats-Server-Xkey in request headers!')
    }

    const decryptedAuthorizationRequestJwt = authorizationRequestCurveKeyPair.open(
        encryptedAuthorizationRequest,
        senderPublicCurveKey
    )

    if (!decryptedAuthorizationRequestJwt) {
        throw new Error('Curve decryption failed')
    }

    const decodedAuthorizationRequest = jsonWebToken.decode(
        new TextDecoder().decode(decryptedAuthorizationRequestJwt),
        { json: true }
    ) as NatsAuthCalloutRequest | null

    if (!decodedAuthorizationRequest?.nats) {
        throw new Error('Invalid NATS auth-callout request payload.')
    }

    return decodedAuthorizationRequest
}

// Creates the signed NATS authorization response JWT.
//
// After the client has been authenticated, NATS still needs a user JWT for the
// ephemeral user nkey in this specific connection attempt. This method resolves
// the final permissions, signs the user JWT with the auth-callout issuer NKey,
// sets the target account audience, then wraps that user JWT in the NATS
// authorization response format.
//
// The target account is important: normal application users receive AUTH
// account JWTs, while NEX receives a NEX account JWT so its `$NEX.>` control
// plane remains isolated from application traffic.
const createAuthorizationResponseJwt = async ({
    authorizationRequest,
    authenticatedClient,
    subscriptions,
    authorizationIssuerKeyPair
}: {
    authorizationRequest: NatsAuthCalloutRequest,
    authenticatedClient: AuthenticatedNatsClient,
    subscriptions: any[],
    authorizationIssuerKeyPair: ReturnType<typeof fromSeed>
}): Promise<string> => {
    const sessionUserPublicNKey = authorizationRequest.nats?.user_nkey
    const serverId = authorizationRequest.nats?.server_id?.id

    if (!sessionUserPublicNKey) {
        throw new Error('Missing NATS user nkey in auth-callout request.')
    }

    if (!serverId) {
        throw new Error('Missing NATS server id in auth-callout request.')
    }

    const permissions = getPermissionsForUser(
        authenticatedClient.userId,
        subscriptions,
        authenticatedClient.servicePermissions
    )

    // NATS expects the callout to return a user JWT for the ephemeral user nkey
    // in this connection attempt. The JWT audience is the target account. For
    // normal browser/API traffic this is AUTH; for NEX it is NEX.
    const userJwt = await encodeUser(
        authenticatedClient.userId,
        sessionUserPublicNKey,
        authorizationIssuerKeyPair,
        {
            ...permissions,
            type: 'user',
            version: 2,
        },
        {
            aud: authenticatedClient.targetNatsAccount
        }
    )

    return encodeAuthorizationResponse(
        sessionUserPublicNKey,
        serverId,
        authorizationIssuerKeyPair.getPublicKey(),
        {
            jwt: userJwt,
            type: 'auth_response',
            version: 2
        },
        {
            signer: authorizationIssuerKeyPair
        }
    )
}

// Starts the NATS auth-callout responder.
//
// This is the public entrypoint for the package. It creates the reusable keys
// and Auth0 verifier, then registers a reply handler on `$SYS.REQ.USER.AUTH`.
// Each request follows the same high-level pipeline:
//
// 1. Decrypt the NATS auth-callout request with the XKey pair.
// 2. Authenticate the client through the token path or raw NKey path.
// 3. Create and return the signed NATS authorization response JWT.
//
// NATS treats an empty response as an authentication failure, so the handler
// catches errors, logs the reason, and returns an empty string instead of
// throwing out of the subscription callback.
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

    const authorizationIssuerKeyPair = fromSeed(Buffer.from(nKeyIssuerSeed))
    const authorizationRequestCurveKeyPair = fromSeed(Buffer.from(xKeyIssuerSeed))

    // Create JWT verifier for Auth0 tokens
    const auth0JwtVerifier = createJwtVerifier({
        jwksUri,
        audience: jwtAudience,
        issuer: jwtIssuer,
        algorithms: jwtAlgorithms
    })


    natsService.reply('$SYS.REQ.USER.AUTH', async (_unusedRequestPayload: any, requestMessage: any) => {
        try {
            const authorizationRequest = decryptAuthorizationRequest({
                encryptedAuthorizationRequest: requestMessage.data,
                requestMessage,
                authorizationRequestCurveKeyPair
            })

            const authenticatedClient = await authenticateClientFromAuthorizationRequest({
                authorizationRequest,
                auth0JwtVerifier,
                serviceAuthConfigs,
                defaultNatsAccount: natsAuthAccount
            })

            return createAuthorizationResponseJwt({
                authorizationRequest,
                authenticatedClient,
                subscriptions,
                authorizationIssuerKeyPair
            })
        } catch (caughtError: any) {
            logError(`Auth Callout Error: ${caughtError.message}`, caughtError)

            return ''    // Return an empty JWT which will be treated as an auth failure
        }
    }, {}, 'buffer')

    info('NATS Auth Callout Service started successfully')
}

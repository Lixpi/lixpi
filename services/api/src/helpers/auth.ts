// DO NOT DELETE ANY OF THE COMMENTED OUT CODE IN THIS FILE

'use strict'

import process from 'process'

import {
    createJwtVerifier,
    type JwtVerificationResult,
} from '@lixpi/auth-service'
import {
    log,
    info,
    infoStr,
    warn,
    err,
} from '@lixpi/debug-tools'

import RegistrationService from '../services/registration-service.ts'

const {
    AUTH0_API_IDENTIFIER,
    AUTH0_DOMAIN,
    MOCK_AUTH0,
    MOCK_AUTH0_DOMAIN,
    MOCK_AUTH0_JWKS_URI,
} = process.env

const registrationService = new RegistrationService()

const isMockAuthEnabled = MOCK_AUTH0 === 'true'

const jwksUri = isMockAuthEnabled
    ? MOCK_AUTH0_JWKS_URI!
    : `${AUTH0_DOMAIN}/.well-known/jwks.json`

const jwtIssuer = isMockAuthEnabled
    ? `http://${MOCK_AUTH0_DOMAIN}/`
    : `${AUTH0_DOMAIN}/`

// Create a single JWT verifier instance for the API
const jwtVerifier = createJwtVerifier({
    jwksUri,
    audience: AUTH0_API_IDENTIFIER!,
    issuer: jwtIssuer,
    algorithms: ['RS256'],
})

const AUTH_REQUEST_CACHE_MS = 5000
const AUTH_EXPIRY_SKEW_MS = 1000
const authRequestCache = new Map<string, { expiresAt: number; result: JwtVerificationResult }>()

// Export the verifier for use in HTTP endpoints (e.g., image upload/proxy)
export { jwtVerifier }

function getAuthRequestCacheKey(token: string, eventName?: string): string {
    return `${eventName ?? '*'}:${token}`
}

function getCachedAuthResult(cacheKey: string): JwtVerificationResult | null {
    const cached = authRequestCache.get(cacheKey)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
        authRequestCache.delete(cacheKey)
        return null
    }
    return cached.result
}

function cacheSuccessfulAuthResult(cacheKey: string, result: JwtVerificationResult): void {
    const expiresAt = getAuthCacheExpiresAt(result.decoded)
    if (expiresAt <= Date.now()) return
    authRequestCache.set(cacheKey, { expiresAt, result })
}

function getAuthCacheExpiresAt(decoded: JwtVerificationResult['decoded']): number {
    const now = Date.now()
    const maxCacheExpiresAt = now + AUTH_REQUEST_CACHE_MS
    const tokenExpiresAt = typeof decoded?.exp === 'number'
        ? (decoded.exp * 1000) - AUTH_EXPIRY_SKEW_MS
        : maxCacheExpiresAt
    return Math.min(maxCacheExpiresAt, tokenExpiresAt)
}

export const authenticateTokenOnRequest = async ({ token, eventName }: { token: string; eventName?: string }): Promise<JwtVerificationResult> => {
    if (!token) return { error: 'No token provided' }

    const cacheKey = getAuthRequestCacheKey(token, eventName)
    const cached = getCachedAuthResult(cacheKey)
    if (cached) return cached

    try {
        const { decoded, error } = await jwtVerifier.verify(token)

        if (error) {
            return { error }
        }

        if (decoded) {
            // TODO: Remove this temporary hack
            await registrationService.verifyRegistration({ decodedToken: decoded, accessToken: token })
            // DO NOT DELETE ANY OF THE COMMENTED OUT CODE IN THIS FILE
            //             err(`
            // calling  await registrationService.verifyRegistration({ decodedToken: decoded, accessToken: token }) in the authenticateTokenOnRequest method.'
            // this is wrong and very quick hack just to make it work temporarily'
            // it used to be called on the connection-auth path in the previous transport, but with NATS it makes no sense'
            // the issue must be addressed when registration flow is complete'
            // const { user, error } = await registrationService.verifyRegistration({ decodedToken: decoded, accessToken: token }
            //             `)

            // TODO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
            // err('TODO: Turn back balance verification !!!!!!!!!!!!!!!', decoded)

            // if (eventName === AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE) {
            //     const userSubscriptionStatus = await subscriptionService.checkUserBalance({ userId: decoded.sub })

            //     if (userSubscriptionStatus === AuthenticationStatus.noActiveSubscription) {
            //         reject({ error: AuthenticationStatus.noActiveSubscription })
            //     }
            // }

            // TODO: Turn back balance verification !!!!!!!!!!!!!!!
            // TODO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

            const result = { decoded }
            cacheSuccessfulAuthResult(cacheKey, result)
            return result
        }

        return { error: 'Token verification failed' }
    } catch (e: any) {
        return { error: e.error || e.message }
    }
}

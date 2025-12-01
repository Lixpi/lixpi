'use strict'

import process from 'process'
import jwt from 'jsonwebtoken'
import jwksClient from 'jwks-rsa'

import { NATS_SUBJECTS, AuthenticationStatus } from '@lixpi/constants'

import { log, info, infoStr, warn, err } from '@lixpi/debug-tools'

import { readFileSynchronously } from './file-loader.ts'
import RegistrationService from '../services/registration-service.ts'
import SubscriptionService from '../services/subscription-service.ts'

const {
    ENVIRONMENT,
    AUTH0_API_IDENTIFIER,
    AUTH0_DOMAIN,
    MOCK_AUTH0,
    MOCK_AUTH0_DOMAIN,
    MOCK_AUTH0_JWKS_URI,
} = process.env
const USE_CACHED_JWKS = false

const registrationService = new RegistrationService()
const subscriptionService = new SubscriptionService()

const { AI_INTERACTION_SUBJECTS } = NATS_SUBJECTS

const isMockAuthEnabled = MOCK_AUTH0 === 'true'

const jwksUri = isMockAuthEnabled
    ? MOCK_AUTH0_JWKS_URI
    : `${AUTH0_DOMAIN}/.well-known/jwks.json`

const jwtIssuer = isMockAuthEnabled
    ? `http://${MOCK_AUTH0_DOMAIN}/`
    : `${AUTH0_DOMAIN}/`

const client = jwksClient({
    jwksUri,
    ...(USE_CACHED_JWKS ? {
        fetcher: () => Promise.resolve(
            JSON.parse(readFileSynchronously(`jwks-keys/jwks.${ENVIRONMENT}.json`, 'utf8'))
        )
    } : {})
})

const getKey = (header, callback) =>
    client.getSigningKey(header.kid, (err, key) =>
        callback(null, key.publicKey || key.rsaPublicKey))

// IMPORTANT !!!! : this is not beinv executed anymore, since we've moved away from Socket.io
// we must find a better way of handling this during the user registration step, for now execution is forced on every authenticateTokenOnRequest() call
export const authenticateTokenOnConnect = async ({ token }) => {
    if (!token) return { error: "No token provided" }

    return new Promise((resolve, reject) => jwt.verify(
        token,
        getKey,
        {
            audience: AUTH0_API_IDENTIFIER,
            issuer: jwtIssuer,
            algorithms: ["RS256"]
        },
        async (error, decoded) => {
            if (error) reject({ error })

            if (decoded) {
                const { user, error } = await registrationService.verifyRegistration({ decodedToken: decoded, accessToken: token })

                if (error)
                    reject({ error })

                resolve({ decoded, user })
            }
        }
    ))
}

export const authenticateTokenOnRequest = async ({ token, eventName }) => {
    if (!token) return { error: "No token provided" }

    return new Promise((resolve, reject) => jwt.verify(
        token,
        getKey,
        {
            audience: AUTH0_API_IDENTIFIER,
            issuer: jwtIssuer,
            algorithms: ["RS256"]
        },
        async (error, decoded) => {
            if (error) reject({ error })

            if (decoded) {

                // TODO: Remove this temporary hack
                await registrationService.verifyRegistration({ decodedToken: decoded, accessToken: token })
                err(`
calling  await registrationService.verifyRegistration({ decodedToken: decoded, accessToken: token }) in the authenticateTokenOnRequest method.'
this is wrong and very quick hack just to make it work temporarily'
it used to be called in authenticateTokenOnConnect() when Socket.io was around, but with NATS it makes no sense'
the issue must be addressed when registration flow is complete'
const { user, error } = await registrationService.verifyRegistration({ decodedToken: decoded, accessToken: token }
                `)

                // TODO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
                err('TODO: Turn back balance verification !!!!!!!!!!!!!!!', decoded)

                // if (eventName === AI_INTERACTION_SUBJECTS.CHAT_SEND_MESSAGE) {
                //     const userSubscriptionStatus = await subscriptionService.checkUserBalance({ userId: decoded.sub })

                //     if (userSubscriptionStatus === AuthenticationStatus.noActiveSubscription) {
                //         reject({ error: AuthenticationStatus.noActiveSubscription })
                //     }
                // }

                // TODO: Turn back balance verification !!!!!!!!!!!!!!!
                // TODO !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

                resolve({ decoded })
            }
        }
    ))
}

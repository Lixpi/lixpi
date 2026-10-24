import process from 'process'
import {
    createJwtVerifier,
    type JwtVerificationResult,
} from '@lixpi/auth-service'
import { AccountAdmission } from '../services/account-admission.ts'
import { AccountAdmissionRuntime } from '../services/account-admission-runtime.ts'

const {
    AUTH0_API_IDENTIFIER,
    AUTH0_DOMAIN,
    MOCK_AUTH0,
    MOCK_AUTH0_DOMAIN,
    MOCK_AUTH0_JWKS_URI,
} = process.env
const isMockAuthEnabled = MOCK_AUTH0 === 'true'
const signatureVerifier = createJwtVerifier({
    jwksUri: isMockAuthEnabled ? MOCK_AUTH0_JWKS_URI! : `${AUTH0_DOMAIN}/.well-known/jwks.json`,
    audience: AUTH0_API_IDENTIFIER!,
    issuer: isMockAuthEnabled ? `http://${MOCK_AUTH0_DOMAIN}/` : `${AUTH0_DOMAIN}/`,
    algorithms: ['RS256'],
})

// Authentication reads completed registration on every request. Account creation
// belongs to hosted provisioning, or the explicit local fixture initializer.
export const jwtVerifier = {
    verify: async (token: string): Promise<JwtVerificationResult> => {
        let result: JwtVerificationResult

        try {
            result = await signatureVerifier.verify(token)
        } catch {
            return { error: 'Invalid or expired token' }
        }

        if (
            result.error
            || !result.decoded
        )
            return result

        try {
            if (process.env.ACCOUNT_ADMISSION_ENABLED === 'true') {
                const runtime = AccountAdmissionRuntime.current()
                await runtime.admission.admitVerifiedToken(result.decoded)
                AccountAdmissionRuntime.current()
            } else {
                if (
                    !isMockAuthEnabled
                    || process.env.ENVIRONMENT !== 'local'
                )
                    return { error: 'ACCOUNT_ADMISSION_DENIED' }

                await AccountAdmission.forEnvironment(global.dynamoDBService, process.env).admitVerifiedToken(result.decoded)
            }

            return result
        } catch {
            return { error: 'ACCOUNT_ADMISSION_DENIED' }
        }
    },
}

export const authenticateTokenOnRequest = async ({ token }: {
    token: string
    eventName?: string
    requireFreshVerification?: boolean
}): Promise<JwtVerificationResult> => {
    if (!token)
        return { error: 'No token provided' }

    return jwtVerifier.verify(token)
}

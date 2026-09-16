import {
    type NatsMiddleware,
} from '@lixpi/nats-service'
import { authenticateTokenOnRequest } from '../../helpers/auth.ts'
import { NATS_SUBJECTS } from '@lixpi/constants'

// JWT Authentication Middleware for NATS
export const jwtAuthMiddleware: NatsMiddleware = async (
    data,
    msg,
) => {
    // The NATS connection-auth handler decrypts this protocol request and verifies
    // its credentials itself. It has no application-level { token } envelope.
    if (msg.subject === '$SYS.REQ.USER.AUTH')
        return {
            data,
            msg,
        }

    const token = data?.token

    if (
        typeof token !== 'string'
        || !token
    )
        throw new Error('Authentication required')

    try {
        const {
            decoded,
            error,
        } = await authenticateTokenOnRequest({
            token,
            eventName: msg.subject,
            requireFreshVerification: msg.subject === NATS_SUBJECTS.ORGANIZATION_SUBJECTS.GET_MEMBERSHIP,
        })

        if (
            error
            || typeof decoded?.sub !== 'string'
            || !decoded.sub
            || typeof decoded.exp !== 'number'
            || decoded.exp * 1000 <= Date.now()
        )
            throw new Error('Invalid or expired token')

        // Add decoded user info to each subject payload
        data.user = {
            userId: decoded.sub,
        }

        // Delete token from subject payload to make it cleaner because the token won't be used again anywhere else down the chain
        delete data.token

        return {
            data,
            msg,
        }
    } catch (error: any) {
        throw new Error(`Authentication failed: ${error.message}`)
    }
}

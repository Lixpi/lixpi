import {
    type NatsMiddleware,
} from '@lixpi/nats-service'
import { authenticateTokenOnRequest } from '../../helpers/auth.ts'
import { NATS_SUBJECTS } from '@lixpi/constants'
import { AccountRequestContext } from '../../services/account-request-context.ts'

// JWT Authentication Middleware for NATS
export const jwtAuthMiddleware: NatsMiddleware = async (
    data,
    msg,
) => {
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

        if (error === 'ACCOUNT_ADMISSION_DENIED')
            throw new Error('ACCOUNT_ADMISSION_DENIED')

        if (
            error
            || typeof decoded?.sub !== 'string'
            || !decoded.sub
            || typeof decoded.exp !== 'number'
            || decoded.exp * 1000 <= Date.now()
        )
            throw new Error('Invalid or expired token')

        // Add decoded user info to each subject payload
        AccountRequestContext.remember(data, decoded)
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
        if (error.message === 'ACCOUNT_ADMISSION_DENIED')
            throw error

        throw new Error(`Authentication failed: ${error.message}`)
    }
}

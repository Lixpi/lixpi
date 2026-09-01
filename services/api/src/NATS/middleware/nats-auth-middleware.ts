import {
    type NatsMiddleware,
} from '@lixpi/nats-service'
import { authenticateTokenOnRequest } from '../../helpers/auth.ts'

// JWT Authentication Middleware for NATS
export const jwtAuthMiddleware: NatsMiddleware = async (data, msg) => {
    const token = data.token

    if (!token) {
        return new Error('jwtAuthMiddleware() -> Authentication required: No token provided')
    }

    try {
        const { decoded, error } = await authenticateTokenOnRequest({ token, eventName: msg.subject })

        if (error) {
            throw new Error('Invalid or expired token')
        }

        // Add decoded user info to each subject payload
        data.user = {
            userId: decoded.sub,
            stripeCustomerId: decoded.stripe_customer_id,
        }

        // Delete token from subject payload to make it cleaner because the token won't be used again anywhere else down the chain
        delete data.token

        return { data, msg }
    } catch (error: any) {
        throw new Error(`Authentication failed: ${error.message}`)
    }
}

import { connect } from '@nats-io/transport-node'

export type RegistrationOptions = {
    servers: string[]
    password: string
    registration: string
}

// This client only delivers approved data. It has no permission-signing key.
export class NatsRegistrationClient {
    static async apply(options: RegistrationOptions): Promise<void> {
        if (
            !options.password
            || !options.registration
        )
            throw new Error('Signed NATS registration and bootstrap password are required')

        const registration = JSON.parse(options.registration)
        const connection = await connect({
            servers: options.servers,
            user: 'registration',
            pass: options.password,
            inboxPrefix: '_REGISTRATION_REPLY',
            name: 'application-registration',
            timeout: 2000,
            reconnect: false,
        })

        try {
            let expectedRevision = 0

            for (let attempt = 0; attempt < 5; attempt++) {
                const response = await connection.request(
                    '$TRANSPORT.REGISTRATION.APPLY',
                    JSON.stringify({
                        registration,
                        expectedRevision,
                    }),
                    { timeout: 5000 },
                )
                const result = response.json<{
                    revision?: number
                    error?: string
                }>()

                if (
                    !result.error
                    && Number.isSafeInteger(result.revision)
                    && result.revision! > 0
                )
                    return

                if (
                    result.error !== 'registration revision conflict'
                    || !Number.isSafeInteger(result.revision)
                )
                    throw new Error(`NATS registration rejected: ${result.error}`)

                expectedRevision = result.revision!
            }

            throw new Error('NATS registration update remained in conflict')
        } finally {
            await connection.close()
        }
    }
}

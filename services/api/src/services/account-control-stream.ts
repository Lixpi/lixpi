import { ACCOUNT_ADMISSION_CHANGED_SUBJECT } from '@lixpi/constants'

type Transport = {
    getConnection: () => {
        request: (
            subject: string,
            data: string,
            options: { timeout: number },
        ) => Promise<{ json: () => any }>
    } | null
}

// Prepare the durable feed before admitting users or starting the account
// writer. An existing stream must be compatible; never update it implicitly.
export class AccountControlStream {
    constructor(private readonly transport: Transport) {}

    async prepare(
        name: string,
        replicas: number,
    ): Promise<void> {
        if (
            !/^[A-Za-z0-9_-]{1,128}$/.test(name)
            || ![1, 3, 5].includes(replicas)
        )
            throw new Error('Invalid admission stream configuration')

        const connection = this.transport.getConnection()

        if (!connection)
            throw new Error('Admission stream requires a NATS connection')

        let result = (await connection.request(
            `$JS.API.STREAM.INFO.${name}`,
            '{}',
            { timeout: 5000 },
        )).json()

        if (result.error?.err_code === 10059)
            result = (await connection.request(
                `$JS.API.STREAM.CREATE.${name}`,
                JSON.stringify({
                    name,
                    subjects: [ACCOUNT_ADMISSION_CHANGED_SUBJECT],
                    storage: 'file',
                    retention: 'limits',
                    num_replicas: replicas,
                    max_age: 0,
                    max_msgs: -1,
                    max_msgs_per_subject: -1,
                    max_bytes: -1,
                    deny_delete: true,
                    deny_purge: true,
                    allow_rollup_hdrs: false,
                }),
                { timeout: 10000 },
            )).json()

        const config = result.config

        if (
            result.error
            || !result.created
            || config?.name !== name
            || config.storage !== 'file'
            || config.retention !== 'limits'
            || config.num_replicas !== replicas
            || JSON.stringify(config.subjects) !== JSON.stringify([ACCOUNT_ADMISSION_CHANGED_SUBJECT])
            || config.max_age !== 0
            || config.max_msgs !== -1
            || config.max_msgs_per_subject !== -1
            || config.max_bytes !== -1
            || config.deny_delete !== true
            || config.deny_purge !== true
            || config.allow_rollup_hdrs === true
        )
            throw new Error('Admission stream is missing or incompatible; existing events were not changed')
    }
}

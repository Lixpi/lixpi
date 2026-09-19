import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'
import { NatsDeploymentAdapter } from './adapter.ts'

const required = (name: string): string => {
    const value = process.env[name]

    if (!value)
        throw new Error(`Missing ${name}`)

    return value
}
const backup = process.argv[2] === 'backup'

if (
    !backup
    && process.argv[2] !== 'serve'
)
    throw new Error('Expected serve or backup')

const adapter = new NatsDeploymentAdapter({
    directory: required(backup ? 'NATS_SNAPSHOT_DIR' : 'NATS_INPUT_DIRECTORY'),
    cluster: required('NATS_METRIC_CLUSTER'),
    certificateSecret: process.env.CERT_SECRET_NAME,
    admissionToken: process.env.NATS_CALLOUT_PASSWORD,
    bucket: process.env.NATS_BACKUP_BUCKET,
    prefix: process.env.NATS_BACKUP_PREFIX,
})

if (backup) {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(
            '/usr/local/bin/lixpi-nats',
            ['backup'],
            {
                stdio: 'inherit',
                env: {
                    NATS_URL: required('NATS_URL'),
                    NATS_BACKUP_NKEY_SEED: required('NATS_BACKUP_NKEY_SEED'),
                    NATS_SNAPSHOT_DIR: required('NATS_SNAPSHOT_DIR'),
                    NATS_BACKUP_SCRATCH: process.env.NATS_BACKUP_SCRATCH ?? '/tmp',
                },
            },
        )
        process.once('SIGTERM', () => child.kill('SIGTERM'))
        process.once('SIGINT', () => child.kill('SIGINT'))
        child.once('error', reject)
        child.once(
            'exit',
            code => code === 0 ? resolve() : reject(
                new Error('Native NATS backup failed'),
            ),
        )
    })
    await adapter.publishBackup()
} else {
    await adapter.prepare()

    while (true) {
        let healthy = true

        try {
            await adapter.refreshCertificate()
        } catch {
            healthy = false
            process.stderr.write('Certificate delivery failed; retaining mounted files\n')
        }

        await adapter.reportCertificates(healthy).catch(() => process.stderr.write('Certificate metric publication failed\n'))
        await setTimeout(60_000)
    }
}

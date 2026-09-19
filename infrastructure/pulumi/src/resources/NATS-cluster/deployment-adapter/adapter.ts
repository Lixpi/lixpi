import { createReadStream } from 'node:fs'
import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises'
import {
    dirname,
    join,
} from 'node:path'
import { isIP } from 'node:net'
import {
    CloudWatchClient,
    PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch'
import {
    GetSecretValueCommand,
    SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'
import {
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'

export type AdapterConfig = {
    directory: string
    certificateSecret?: string
    cluster: string
    admissionToken?: string
    bucket?: string
    prefix?: string
}

export class NatsDeploymentAdapter {
    constructor(
        private readonly config: AdapterConfig,
        private readonly secrets = new SecretsManagerClient({}),
        private readonly metrics = new CloudWatchClient({}),
        private readonly storage = new S3Client({}),
        private readonly request = fetch,
        private readonly upload = async (key: string, filename: string): Promise<void> => void (await new Upload({
            client: this.storage,
            params: {
                Bucket: this.config.bucket,
                Key: key,
                Body: createReadStream(filename),
            },
            queueSize: 2,
            partSize: 32 * 1024 * 1024,
        }).done()),
    ) {}

    prepare = async (): Promise<void> => {
        const endpoint = 'http://169.254.169.254/latest'
        const tokenResponse = await this.request(
            `${endpoint}/api/token`,
            {
                method: 'PUT',
                headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '60' },
                signal: AbortSignal.timeout(5000),
            },
        )

        if (!tokenResponse.ok)
            throw new Error('Cannot obtain instance metadata token')

        const token = await tokenResponse.text()
        const metadata = async (path: string): Promise<string> => {
            const response = await this.request(
                `${endpoint}/meta-data/${path}`,
                {
                    headers: { 'X-aws-ec2-metadata-token': token },
                    signal: AbortSignal.timeout(5000),
                },
            )

            if (!response.ok)
                throw new Error('Cannot read instance metadata')

            return (await response.text()).trim()
        }
        const zone = await metadata('placement/availability-zone')
        const advertiseIP = await metadata('local-ipv4')

        if (
            !zone
            || !isIP(advertiseIP)
        )
            throw new Error('Invalid node metadata')

        await mkdir(
            this.config.directory,
            {
                recursive: true,
                mode: 0o700,
            },
        )
        await writeFile(
            join(this.config.directory, 'node.json.tmp'),
            JSON.stringify({
                zone,
                advertiseIP,
            }),
            { mode: 0o600 },
        )
        await rename(
            join(this.config.directory, 'node.json.tmp'),
            join(this.config.directory, 'node.json'),
        )
        await this.refreshCertificate()
    }

    refreshCertificate = async (): Promise<void> => {
        if (!this.config.certificateSecret)
            throw new Error('Certificate secret is required by the AWS deployment')

        const response = await this.secrets.send(
            new GetSecretValueCommand({ SecretId: this.config.certificateSecret }),
        )
        const value = JSON.parse(response.SecretString ?? '{}')

        if (
            typeof value.certificate !== 'string'
            || !value.certificate
            || typeof value.private_key !== 'string'
            || !value.private_key
        )
            throw new Error('Certificate secret has no certificate/key pair')

        await mkdir(
            this.config.directory,
            {
                recursive: true,
                mode: 0o700,
            },
        )
        const current = join(this.config.directory, 'current')

        try {
            if (
                (await readFile(
                    join(current, 'certificate.pem'),
                    'utf8',
                )) === value.certificate
                && (await readFile(
                    join(current, 'private-key.pem'),
                    'utf8',
                )) === value.private_key
            )
                return
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
                throw error
        }

        const version = await mkdtemp(
            join(this.config.directory, 'certificate-'),
        )

        try {
            await writeFile(
                join(version, 'certificate.pem'),
                value.certificate,
                { mode: 0o600 },
            )
            await writeFile(
                join(version, 'private-key.pem'),
                value.private_key,
                { mode: 0o600 },
            )
            const next = join(this.config.directory, 'next')
            await rm(next, { force: true })
            await symlink(version, next)
            await rename(next, current)
        } catch (error) {
            await rm(
                version,
                {
                    recursive: true,
                    force: true,
                },
            )

            throw error
        }

        // The broker keeps its own validated certificate copy and rollback state.
        for (const entry of await readdir(this.config.directory))
            if (
                entry.startsWith('certificate-')
                && join(this.config.directory, entry) !== version
            )
                await rm(
                    join(this.config.directory, entry),
                    {
                        recursive: true,
                        force: true,
                    },
                )
    }

    reportCertificates = async (deliveryHealthy: boolean): Promise<void> => {
        let refreshHealthy = false
        let validBeyondSevenDays = false
        let serverName: string | undefined

        try {
            const response = await this.request(
                'http://127.0.0.1:3020/metrics',
                {
                    headers: { Authorization: `Bearer ${this.config.admissionToken}` },
                    signal: AbortSignal.timeout(2000),
                },
            )

            if (response.ok) {
                const status = await response.json()
                refreshHealthy = deliveryHealthy && status.certificateRefreshHealthy === true
                validBeyondSevenDays = status.certificateValidBeyondSevenDays === true

                if (
                    typeof status.serverName === 'string'
                    && status.serverName
                )
                    serverName = status.serverName
            }
        } catch {}

        await this.metrics.send(
            new PutMetricDataCommand({
                Namespace: 'Lixpi/NATS',
                MetricData: [
                    {
                        MetricName: 'CertificateRefreshHealthy',
                        Value: Number(refreshHealthy),
                        Unit: 'Count' as const,
                        Dimensions: [{
                            Name: 'Cluster',
                            Value: this.config.cluster,
                        }],
                    },
                    {
                        MetricName: 'CertificateValidBeyondSevenDays',
                        Value: Number(validBeyondSevenDays),
                        Unit: 'Count' as const,
                        Dimensions: [{
                            Name: 'Cluster',
                            Value: this.config.cluster,
                        }],
                    },
                ].flatMap(
                    metric => serverName ? [metric, {
                        ...metric,
                        Dimensions: [...metric.Dimensions, {
                            Name: 'Server',
                            Value: serverName,
                        }],
                    }] : [metric],
                ),
            }),
        )
    }

    publishBackup = async (): Promise<void> => {
        if (!this.config.bucket)
            throw new Error('Backup bucket is required by the AWS deployment')

        const id = (await readFile(
            join(this.config.directory, 'LATEST'),
            'utf8',
        )).trim()

        if (
            !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)
            || (await readFile(
                join(
                    this.config.directory,
                    id,
                    'COMPLETE',
                ),
                'utf8',
            )).trim() !== id
        )
            throw new Error('Snapshot is incomplete')

        const prefix = `${this.config.prefix ?? 'jetstream'}/${id}`
        const walk = async (directory: string): Promise<void> => {
            for (const entry of await readdir(
                join(
                    this.config.directory,
                    id,
                    directory,
                ),
                { withFileTypes: true },
            )) {
                const name = join(directory, entry.name)

                if (entry.isDirectory())
                    await walk(name)
                else if (
                    entry.isFile()
                    && name !== 'COMPLETE'
                )
                    await this.upload(
                        `${prefix}/${name}`,
                        join(
                            this.config.directory,
                            id,
                            name,
                        ),
                    )
                else if (!entry.isFile())
                    throw new Error('Unsupported snapshot file')
            }
        }
        await walk('')
        await this.storage.send(
            new PutObjectCommand({
                Bucket: this.config.bucket,
                Key: `${prefix}/COMPLETE`,
                Body: `${id}\n`,
            }),
        )
        await this.storage.send(
            new PutObjectCommand({
                Bucket: this.config.bucket,
                Key: `${dirname(prefix)}/LATEST`,
                Body: `${id}\n`,
            }),
        )
        await this.metrics.send(
            new PutMetricDataCommand({
                Namespace: 'Lixpi/NATS',
                MetricData: [{
                    MetricName: 'BackupComplete',
                    Value: 1,
                    Unit: 'Count',
                    Dimensions: [{
                        Name: 'Cluster',
                        Value: this.config.cluster,
                    }],
                }],
            }),
        )
    }
}

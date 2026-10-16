import { hostname } from 'node:os'

export type AccountProcessDeployment = {
    kind: 'compose' | 'ecs'
    container: string
    task: string
    process?: string
}

// Deployment identity is distinct from the random process/consumer identity.
// A later process in the same container cannot inherit an earlier acknowledgement.
export class AccountProcessIdentity {
    constructor(
        private readonly environment: Record<string, string | undefined> = process.env,
        private readonly localHostname: () => string = hostname,
        private readonly request: typeof fetch = fetch,
        private readonly runtime: { title: string } = process,
    ) {}

    async read(consumer?: string): Promise<AccountProcessDeployment> {
        const metadata = this.environment.ECS_CONTAINER_METADATA_URI_V4

        if (metadata) {
            const url = new URL(metadata)

            if (
                url.origin !== 'http://169.254.170.2'
                || !/^\/v4\/[A-Za-z0-9-]{1,128}$/.test(url.pathname)
                || url.username
                || url.password
                || url.search
                || url.hash
            )
                throw new Error('Invalid ECS admission metadata endpoint')

            const container = await this.json(url.href)
            const task = await this.json(`${url.href}/task`)

            if (
                typeof container.DockerId !== 'string'
                || !/^[a-f0-9]{32,64}(?:-[0-9]+)?$/.test(container.DockerId)
                || typeof task.TaskARN !== 'string'
                || !/^arn:aws:ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/.test(task.TaskARN)
                || !Array.isArray(task.Containers)
                || task.Containers.filter((item: Record<string, unknown>) => item?.DockerId === container.DockerId).length !== 1
            )
                throw new Error('Incomplete ECS admission process identity')

            return {
                kind: 'ecs',
                container: container.DockerId,
                task: task.TaskARN,
            }
        }

        const container = this.localHostname()

        if (
            this.environment.ENVIRONMENT !== 'local'
            || !/^[a-f0-9]{12,64}$/.test(container)
        )
            throw new Error('Admission enforcement requires local Docker identity or ECS task metadata')

        if (consumer) {
            if (!/^admission_api_[a-f0-9]{32}$/.test(consumer))
                throw new Error('Invalid admission process name')

            // Docker's complete process list distinguishes nodemon children in
            // one container. Register this before publishing the consumer, and
            // never change it during the lifetime of this process.
            this.runtime.title = consumer

            if (this.runtime.title !== consumer)
                throw new Error('Docker admission process title was truncated')
        }

        return {
            kind: 'compose',
            container,
            task: '',
            ...(consumer ? { process: consumer } : {}),
        }
    }

    private async json(url: string): Promise<Record<string, any>> {
        const response = await this.request(
            url,
            {
                redirect: 'error',
                signal: AbortSignal.timeout(3000),
            },
        )

        if (
            !response.ok
            || !response.body
        )
            throw new Error('Admission deployment metadata is unavailable')

        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0

        try {
            for (;;) {
                const chunk = await reader.read()

                if (chunk.done)
                    break

                size += chunk.value.byteLength

                if (size > 128 * 1024)
                    throw new Error('Admission deployment metadata exceeds its limit')

                chunks.push(chunk.value)
            }
        } finally {
            await reader.cancel()
        }

        const value = JSON.parse(
            Buffer.concat(chunks).toString('utf8'),
        )

        if (
            !value
            || typeof value !== 'object'
            || Array.isArray(value)
        )
            throw new Error('Invalid admission deployment metadata')

        return value
    }
}

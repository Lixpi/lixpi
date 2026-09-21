import {
    type ReleaseGroup,
} from './dependency-selector.ts'

export type ReleaseEvidence = {
    version: string
    url: string
    engines?: unknown
}

const identityVersion = (version: string): string => version

export class HttpResponseError extends Error {
    readonly status: number
    readonly url: string

    constructor(
        status: number,
        url: string,
    ) {
        super(`${status}: ${url}`)
        this.status = status
        this.url = url
    }
}

export class ReleaseClient {
    readonly evidence: Record<ReleaseGroup, Record<string, ReleaseEvidence>> = {
        npmPackages: {},
        goModules: {},
        packageManagers: {},
        runtimes: {},
        tools: {},
        goTools: {},
        containerImages: {},
        githubActions: {},
    }
    private readonly jsonResponses = new Map<string, unknown>()
    private readonly textResponses = new Map<string, string>()

    async fetchJson(url: string): Promise<unknown> {
        if (this.jsonResponses.has(url))
            return this.jsonResponses.get(url)

        const githubToken = process.env.GITHUB_TOKEN
        const response = await fetch(
            url,
            {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'lixpi-versions-registry',
                    ...(url.startsWith('https://api.github.com/') ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
                    ...(url.startsWith('https://api.github.com/')
                        && githubToken
                        ? { Authorization: `Bearer ${githubToken}` }
                        : {}),
                },
                signal: AbortSignal.timeout(30_000),
            },
        )

        if (!response.ok)
            throw new HttpResponseError(response.status, url)

        const data = await response.json()
        this.jsonResponses.set(url, data)

        return data
    }

    async fetchText(url: string): Promise<string> {
        const cached = this.textResponses.get(url)

        if (cached !== undefined)
            return cached

        const response = await fetch(
            url,
            {
                headers: {
                    'User-Agent': 'lixpi-versions-registry',
                },
                signal: AbortSignal.timeout(30_000),
            },
        )

        if (!response.ok)
            throw new HttpResponseError(response.status, url)

        const data = await response.text()
        this.textResponses.set(url, data)

        return data
    }

    async releaseVersion(
        group: ReleaseGroup,
        name: string,
        url: string,
        selectVersion: (data: unknown) => string,
        normalizeVersion: (version: string) => string = identityVersion,
    ): Promise<string> {
        const data = await this.fetchJson(url)
        const version = normalizeVersion(
            selectVersion(data),
        )

        if (
            !version
            || /[\r\n]/.test(version)
        )
            throw new Error(`No release version in ${url}`)

        const engines = data
            && typeof data === 'object'
            && Object.hasOwn(data, 'engines')
            ? (data as Record<string, unknown>).engines
            : undefined

        this.evidence[group][name] = {
            version,
            url,
            ...(engines === undefined ? {} : { engines }),
        }

        return version
    }

    recordRelease(
        group: ReleaseGroup,
        name: string,
        version: string,
        url: string,
    ): void {
        this.evidence[group][name] = {
            version,
            url,
        }
    }

    async inBatches<T>(
        items: T[],
        task: (item: T) => Promise<void>,
    ): Promise<void> {
        for (let offset = 0; offset < items.length; offset += 8) {
            const results = await Promise.allSettled(
                items.slice(offset, offset + 8).map(task),
            )
            const failures = results.filter(result => result.status === 'rejected')

            if (failures.length)
                throw new AggregateError(
                    failures.map(failure => failure.reason),
                    'Release lookup failed; version catalogs were not written',
                )
        }
    }
}

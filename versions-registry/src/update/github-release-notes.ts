import {
    HttpResponseError,
    type ReleaseClient,
} from './release-client.ts'
import {
    unavailableReleaseNotes,
    type GithubReleaseSource,
    type ReleaseChange,
    type ReleaseNotesReview,
} from './release-notes.ts'
import {
    comparableVersion,
    compareVersions,
    pseudoVersionCommit,
    versionBetween,
    versionText,
    type ComparableVersion,
} from './semantic-version.ts'

type GithubRelease = {
    tagName: string
    title: string
    body: string
    publishedAt?: string
    url: string
}

const unique = (values: string[]): string[] => [...new Set(values)]

export class GithubReleaseNotesResolver {
    private readonly client: ReleaseClient

    constructor(client: ReleaseClient) {
        this.client = client
    }

    async resolve(
        source: GithubReleaseSource,
        currentVersion: string,
        latestVersion: string,
    ): Promise<ReleaseNotesReview> {
        const current = comparableVersion(currentVersion)
        const latest = comparableVersion(latestVersion)

        if (
            !current
            || !latest
        )
            return unavailableReleaseNotes(`Versions for ${source.repository} could not be compared as semantic versions.`)

        const releases = await this.releases(source, current)

        for (const prefix of source.tagPrefixes) {
            const changes = releases.flatMap(release => {
                if (!release.tagName.startsWith(prefix))
                    return []

                const version = comparableVersion(
                    release.tagName.slice(prefix.length),
                )

                if (
                    !version
                    || !versionBetween(
                        version,
                        current,
                        latest,
                    )
                )
                    return []

                return [{
                    comparable: version,
                    version: versionText(version),
                    title: release.title,
                    ...(release.publishedAt ? { publishedAt: release.publishedAt } : {}),
                    url: release.url,
                    notes: release.body,
                }]
            }).sort((left, right) => compareVersions(left.comparable, right.comparable))

            if (
                changes.length
                && changes.every(change => change.notes.trim())
            )
                return {
                    status: 'available',
                    sourceType: 'githubReleases',
                    sourceUrl: `https://github.com/${source.repository}/releases`,
                    changes: changes.map(({
                        comparable: _comparable,
                        ...change
                    }) => change),
                }
        }

        const comparison = await this.comparison(
            source,
            currentVersion,
            latestVersion,
        )

        return comparison ?? unavailableReleaseNotes(
            `No GitHub release notes or comparable tags were found for ${source.repository} between ${currentVersion} and ${latestVersion}.`,
            `https://github.com/${source.repository}`,
        )
    }

    private async releases(
        source: GithubReleaseSource,
        current: ComparableVersion,
    ): Promise<GithubRelease[]> {
        const releases: GithubRelease[] = []

        for (let page = 1; page <= 100; page++) {
            const url = `https://api.github.com/repos/${source.repository}/releases?per_page=100&page=${page}`
            let data: unknown

            try {
                data = await this.client.fetchJson(url)
            } catch (error) {
                if (
                    error instanceof HttpResponseError
                    && error.status === 404
                )
                    return []

                throw error
            }

            if (!Array.isArray(data))
                throw new Error(`Expected GitHub releases for ${source.repository}`)

            for (const item of data) {
                if (
                    !item
                    || typeof item !== 'object'
                )
                    continue

                const record = item as Record<string, unknown>

                if (
                    record.draft === true
                    || record.prerelease === true
                    || typeof record.tag_name !== 'string'
                    || typeof record.html_url !== 'string'
                )
                    continue

                releases.push({
                    tagName: record.tag_name,
                    title: typeof record.name === 'string'
                        && record.name
                        ? record.name
                        : record.tag_name,
                    body: typeof record.body === 'string' ? record.body : '',
                    ...(typeof record.published_at === 'string' ? { publishedAt: record.published_at } : {}),
                    url: record.html_url,
                })
            }

            if (data.length < 100)
                break

            const reachedCurrent = releases.some(release => {
                for (const prefix of source.tagPrefixes) {
                    if (!release.tagName.startsWith(prefix))
                        continue

                    const version = comparableVersion(
                        release.tagName.slice(prefix.length),
                    )

                    if (
                        version
                        && compareVersions(version, current) <= 0
                    )
                        return true
                }

                return false
            })

            if (reachedCurrent)
                break

            if (page === 100)
                throw new Error(`GitHub release pagination exceeded 100 pages for ${source.repository}`)
        }

        return releases
    }

    private async comparison(
        source: GithubReleaseSource,
        currentVersion: string,
        latestVersion: string,
    ): Promise<ReleaseNotesReview | undefined> {
        const current = currentVersion.replace(/^v/, '')
        const latest = latestVersion.replace(/^v/, '')
        const currentCommit = pseudoVersionCommit(currentVersion)
        const latestCommit = pseudoVersionCommit(latestVersion)
        const tagReferencePairs = source.tagPrefixes.flatMap(
            prefix => [
                `${prefix}v${current}\0${prefix}v${latest}`,
                `${prefix}${current}\0${prefix}${latest}`,
                ...(currentCommit
                    ? [
                        `${currentCommit}\0${prefix}v${latest}`,
                        `${currentCommit}\0${prefix}${latest}`,
                    ]
                    : []),
                ...(latestCommit
                    ? [
                        `${prefix}v${current}\0${latestCommit}`,
                        `${prefix}${current}\0${latestCommit}`,
                    ]
                    : []),
            ],
        )
        const referencePairs = unique([
            ...(currentCommit
                && latestCommit
                ? [`${currentCommit}\0${latestCommit}`]
                : []),
            ...tagReferencePairs,
        ])

        for (const pair of referencePairs) {
            const [base, head] = pair.split('\0')
            const comparison = await this.comparisonForReferences(
                source.repository,
                base,
                head,
            )

            if (comparison)
                return comparison
        }

        return undefined
    }

    private async comparisonForReferences(
        repository: string,
        base: string,
        head: string,
    ): Promise<ReleaseNotesReview | undefined> {
        const changes: ReleaseChange[] = []
        let sourceUrl: string | undefined
        let totalCommits: number | undefined

        for (let page = 1; page <= 100; page++) {
            const apiUrl = `https://api.github.com/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=100&page=${page}`
            let data: unknown

            try {
                data = await this.client.fetchJson(apiUrl)
            } catch (error) {
                if (
                    error instanceof HttpResponseError
                    && error.status === 404
                )
                    return undefined

                throw error
            }

            if (
                !data
                || typeof data !== 'object'
            )
                throw new Error(`Expected GitHub comparison for ${repository}`)

            const record = data as Record<string, unknown>

            if (!Array.isArray(record.commits))
                throw new Error(`Expected GitHub comparison commits for ${repository}`)

            if (typeof record.html_url === 'string')
                sourceUrl = record.html_url

            if (typeof record.total_commits === 'number')
                totalCommits = record.total_commits

            for (const item of record.commits) {
                if (
                    !item
                    || typeof item !== 'object'
                )
                    continue

                const commit = item as Record<string, unknown>
                const detail = commit.commit

                if (
                    !detail
                    || typeof detail !== 'object'
                    || typeof (detail as Record<string, unknown>).message !== 'string'
                    || typeof commit.html_url !== 'string'
                )
                    continue

                const detailRecord = detail as Record<string, unknown>
                const message = detailRecord.message as string
                const author = detailRecord.author
                const publishedAt = author
                    && typeof author === 'object'
                    && typeof (author as Record<string, unknown>).date === 'string'
                    ? (author as Record<string, unknown>).date as string
                    : undefined

                changes.push({
                    version: typeof commit.sha === 'string' ? commit.sha : head,
                    title: message.split('\n')[0],
                    ...(publishedAt ? { publishedAt } : {}),
                    url: commit.html_url,
                    notes: message,
                })
            }

            if (
                record.commits.length < 100
                || (totalCommits !== undefined && changes.length >= totalCommits)
            )
                break
        }

        if (!sourceUrl)
            sourceUrl = `https://github.com/${repository}/compare/${base}...${head}`

        if (
            !changes.length
            || totalCommits === undefined
            || changes.length < totalCommits
        )
            return undefined

        return {
            status: 'available',
            sourceType: 'githubCommits',
            sourceUrl,
            changes,
        }
    }
}

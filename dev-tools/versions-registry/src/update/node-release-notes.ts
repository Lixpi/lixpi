import {
    type ReleaseClient,
} from './release-client.ts'
import {
    unavailableReleaseNotes,
    type ReleaseChange,
    type ReleaseNotesReview,
} from './release-notes.ts'
import {
    comparableVersion,
    compareVersions,
    versionBetween,
    type ComparableVersion,
} from './semantic-version.ts'

export class NodeReleaseNotesResolver {
    private readonly client: ReleaseClient

    constructor(client: ReleaseClient) {
        this.client = client
    }

    async resolve(
        currentVersion: string,
        latestVersion: string,
    ): Promise<ReleaseNotesReview> {
        const current = comparableVersion(currentVersion)
        const latest = comparableVersion(latestVersion)

        if (
            !current
            || !latest
        )
            return unavailableReleaseNotes('Node.js versions could not be compared as semantic versions.')

        const changes: Array<ReleaseChange & { comparable: ComparableVersion }> = []

        for (let major = current.major; major <= latest.major; major++) {
            const url = `https://raw.githubusercontent.com/nodejs/node/main/doc/changelogs/CHANGELOG_V${major}.md`
            const markdown = await this.client.fetchText(url)
            const headings = [...markdown.matchAll(/^## (.*\bVersion (\d+\.\d+\.\d+).*)$/gm)]

            for (let index = 0; index < headings.length; index++) {
                const heading = headings[index]
                const version = comparableVersion(heading[2])

                if (
                    !version
                    || !versionBetween(
                        version,
                        current,
                        latest,
                    )
                )
                    continue

                const start = heading.index ?? 0
                const end = headings[index + 1]?.index ?? markdown.length
                changes.push({
                    comparable: version,
                    version: heading[2],
                    title: heading[1],
                    url,
                    notes: markdown.slice(start, end).trim(),
                })
            }
        }

        changes.sort((left, right) => compareVersions(left.comparable, right.comparable))

        if (!changes.length)
            return unavailableReleaseNotes(
                `No Node.js changelog entries were found between ${currentVersion} and ${latestVersion}.`,
                'https://github.com/nodejs/node/tree/main/doc/changelogs',
            )

        return {
            status: 'available',
            sourceType: 'nodeChangelog',
            sourceUrl: 'https://github.com/nodejs/node/tree/main/doc/changelogs',
            changes: changes.map(({
                comparable: _comparable,
                ...change
            }) => change),
        }
    }
}

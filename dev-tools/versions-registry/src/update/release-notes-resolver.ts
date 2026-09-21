import {
    type ResolvedDependencyRelease,
} from './latest-release-resolver.ts'
import { GithubReleaseNotesResolver } from './github-release-notes.ts'
import { NodeReleaseNotesResolver } from './node-release-notes.ts'
import {
    type ReleaseClient,
} from './release-client.ts'
import {
    unavailableReleaseNotes,
    type ReleaseNotesReview,
} from './release-notes.ts'
import { ReleaseNotesSourceResolver } from './release-notes-sources.ts'

export class ReleaseNotesResolver {
    private readonly sources: ReleaseNotesSourceResolver
    private readonly node: NodeReleaseNotesResolver
    private readonly github: GithubReleaseNotesResolver

    constructor(client: ReleaseClient) {
        this.sources = new ReleaseNotesSourceResolver(client)
        this.node = new NodeReleaseNotesResolver(client)
        this.github = new GithubReleaseNotesResolver(client)
    }

    async review(release: ResolvedDependencyRelease): Promise<ReleaseNotesReview> {
        if (release.currentVersion === release.latestVersion)
            return {
                status: 'unchanged',
                changes: [],
            }

        const source = await this.sources.resolve(release)

        if (source.kind === 'unavailable')
            return unavailableReleaseNotes(source.message, source.sourceUrl)

        if (source.kind === 'nodeChangelog')
            return this.node.resolve(release.currentVersion, release.latestVersion)

        return this.github.resolve(
            source.github,
            release.currentVersion,
            release.latestVersion,
        )
    }
}

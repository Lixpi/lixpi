export type ReleaseChange = {
    version: string
    title: string
    publishedAt?: string
    url: string
    notes: string
}

export type ReleaseNotesReview = {
    status: 'unchanged' | 'available' | 'unavailable'
    sourceType?: 'nodeChangelog' | 'githubReleases' | 'githubCommits'
    sourceUrl?: string
    message?: string
    changes: ReleaseChange[]
}

export type GithubReleaseSource = {
    repository: string
    tagPrefixes: string[]
}

export const unavailableReleaseNotes = (
    message: string,
    sourceUrl?: string,
): ReleaseNotesReview => ({
    status: 'unavailable',
    sourceUrl,
    message,
    changes: [],
})
